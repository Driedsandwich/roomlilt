import { randomUUID } from 'node:crypto';
import { resolve, relative, isAbsolute } from 'node:path';
import type { Server as HttpServer } from 'node:http';
import express from 'express';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ElicitResultSchema, isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { HouseholdStore } from '../domain/store.js';
import { createDemoState } from '../domain/seed.js';
import { findConflicts, proposePlans, applyPlan, reportChange } from '../domain/solver.js';
import type { Plan, MemberId, ToolData } from '../shared/types.js';
import { CONSENT_TIMEOUT_MS } from '../shared/timeouts.js';

export const PROTOCOL_VERSION = '2025-11-25';

function result(data: ToolData): CallToolResult {
  return { content: [{ type: 'text', text: data.message }], structuredContent: { ...data } };
}

function toolError(error: unknown): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : 'The operation failed.' }] };
}

export function localDataPath(filePath = 'data/household.json'): string {
  const root = process.cwd();
  const path = resolve(root, filePath);
  const fromRoot = relative(root, path);
  if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) throw new Error('The data file must be inside this project directory.');
  return path;
}

export async function createApplication(options: { dataFile?: string } = {}) {
  const store = new HouseholdStore(localDataPath(options.dataFile));
  await store.load();
  const app = createMcpExpressApp({ host: '127.0.0.1' });
  const sessions = new Map<string, { server: McpServer; transport: StreamableHTTPServerTransport; lastActivity: number }>();
  const sessionIdleMs = 30 * 60_000;
  let sessionInitialization: Promise<unknown> = Promise.resolve();
  function touchSession(id: string) {
    const session = sessions.get(id);
    if (!session) return;
    session.lastActivity = Date.now();
    // Map order breaks ties when requests occur within the same millisecond.
    sessions.delete(id);
    sessions.set(id, session);
  }
  async function closeSession(id: string) {
    const session = sessions.get(id);
    sessions.delete(id);
    await session?.server.close();
  }
  async function expireIdleSessions() {
    const now = Date.now();
    await Promise.allSettled([...sessions].filter(([, session]) => now - session.lastActivity > sessionIdleMs).map(([id]) => closeSession(id)));
  }
  const sessionExpiry = setInterval(() => { void expireIdleSessions(); }, 60_000);
  sessionExpiry.unref();
  let transaction: Promise<unknown> = Promise.resolve();
  // Consent may take time: hold no write lock while a person considers it.
  // Recheck the revision inside this short write transaction after all consent arrives.
  function mutate<T>(operation: () => Promise<T>): Promise<T> {
    const next = transaction.then(operation);
    transaction = next.catch(() => undefined);
    return next;
  }

  const allowedOrigins = new Set([
    'http://127.0.0.1:5173', 'http://localhost:5173',
    'http://127.0.0.1:4173', 'http://localhost:4173',
    'http://127.0.0.1:3001', 'http://localhost:3001',
  ]);
  app.use('/mcp', (req, res, next) => {
    const origin = req.get('origin');
    // Native clients omit Origin. Browser clients must use a known local UI origin.
    if (origin && !allowedOrigins.has(origin)) {
      res.status(403).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Origin is not an allowed local demo origin.' }, id: null });
      return;
    }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id, MCP-Protocol-Version');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID');
      res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
    }
    if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
    next();
  });
  app.get('/health', (_req, res) => res.json({ name: 'roomlilt', status: 'ok', protocolVersion: PROTOCOL_VERSION }));

  function makeServer() {
    const server = new McpServer({ name: 'roomlilt', version: '1.0.0' }, {
      instructions: 'A fictional household demo. Protect fixed sleep. Compare disruption and fairness history. Obtain explicit form consent from every yielding member before committing. Never assume agreement.',
    });
    const offeredPlans = new Map<string, Plan>();
    function offer(plans: Plan[]) {
      // Replace the menu rather than retaining unlimited obsolete plans per session.
      offeredPlans.clear();
      for (const plan of plans) offeredPlans.set(plan.id, structuredClone(plan));
    }

    server.registerTool('get_household_state', {
      description: 'Read the fictional household schedule, protected sleep, and persisted agreements.',
      inputSchema: {}, annotations: { readOnlyHint: true },
    }, async () => result({ kind: 'state', message: 'Here is the household schedule and what everyone agreed.', state: store.snapshot() }));

    server.registerTool('get_fairness_ledger', {
      description: 'Read yields in the last 14 days, separated into required and negotiated yields, with bounded effort points.',
      inputSchema: {}, annotations: { readOnlyHint: true },
    }, async () => {
      const state = store.snapshot();
      const summaries = state.ledger.map(entry => {
        const name = state.members.find(member => member.id === entry.memberId)?.name ?? entry.memberId;
        return `${name}: ${entry.yieldCount} yield${entry.yieldCount === 1 ? '' : 's'} (${entry.requiredYields} required, ${entry.negotiatedYields} negotiated), ${entry.effortPoints} effort points`;
      });
      return result({ kind: 'ledger', message: `Yields in the last 14 days, including today's agreements. ${summaries.join('; ')}. Effort points are bounded for each adjustment.`, ledger: state.ledger });
    });

    server.registerTool('find_conflicts', {
      description: 'Find overlapping shared resources and noise versus quiet constraints for a demo date.',
      inputSchema: { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() },
      annotations: { readOnlyHint: true },
    }, async ({ date }) => {
      const state = store.snapshot();
      const conflicts = findConflicts(state, date ?? state.date);
      return result({ kind: 'conflicts', message: conflicts.length ? `${conflicts.length} conflict group${conflicts.length === 1 ? ' needs' : 's need'} an agreement. Protected needs stay unchanged.` : 'No clashes for this date.', conflicts, state });
    });

    server.registerTool('propose_plans', {
      description: 'Compare up to three feasible plans with concrete member changes and fairness impact. Replaces this session\'s previous proposal menu; resolve one conflict group at a time. Does not commit.',
      inputSchema: { conflictId: z.string().min(1), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }, annotations: { readOnlyHint: true },
    }, async ({ conflictId, date }) => {
      try {
        const plans = proposePlans(store.snapshot(), conflictId, date);
        offer(plans);
        return result({ kind: 'plans', message: plans.length ? 'Compare the changes and badges. The recommended plan balances disruption with past yielding; nobody is committed yet.' : 'No feasible options are available for this conflict.', plans, ledger: store.snapshot().ledger });
      } catch (error) { return toolError(error); }
    });

    server.registerTool('commit_plan', {
      description: 'Ask every yielding member for explicit MCP form consent. Commit atomically only when everyone accepts the exact current plan.',
      inputSchema: { planId: z.string().min(1) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    }, async ({ planId }, extra) => {
      const plan = offeredPlans.get(planId);
      if (!plan) return toolError(new Error('Choose a plan proposed in this session first.'));
      const initial = store.snapshot();
      if (initial.revision !== plan.revision) return toolError(new Error('The household changed. Find a fresh plan before consenting.'));
      const caps = server.server.getClientCapabilities();
      if (!caps?.elicitation || (Object.keys(caps.elicitation).length > 0 && !caps.elicitation.form)) {
        return toolError(new Error('This client must support MCP form elicitation. Nothing was committed.'));
      }
      const consentDeadline = Date.now() + CONSENT_TIMEOUT_MS;
      function checkConsentWait() {
        if (extra.signal.aborted) throw new Error('The request was cancelled. Nothing was committed.');
        if (Date.now() >= consentDeadline) throw new Error('Consent timed out. Nothing was committed.');
      }
      try {
        const acceptedBy: MemberId[] = [];
        for (const memberId of plan.yieldingMemberIds) {
          checkConsentWait();
          const member = initial.members.find(item => item.id === memberId)!;
          const changes = plan.changes.filter(change => change.memberId === memberId).map(change => change.description).join('\n');
          const consent = await extra.sendRequest({
            method: 'elicitation/create',
            params: {
              mode: 'form',
              message: `${member.name}, do you agree to "${plan.title}"?\n${changes}\nYour ledger will record this adjustment. This is a fictional member role, not authenticated identity.`,
              requestedSchema: {
                type: 'object',
                properties: {
                  consent: { type: 'boolean', title: 'I agree to these exact changes' },
                  memberId: { type: 'string', title: 'Yielding member', enum: [memberId] },
                },
                required: ['consent', 'memberId'],
              },
            },
          }, ElicitResultSchema, { signal: extra.signal, timeout: consentDeadline - Date.now() });
          checkConsentWait();
          if (consent.action !== 'accept' || consent.content?.consent !== true || consent.content?.memberId !== memberId) {
            return result({ kind: 'commit', message: `${member.name} did not consent. The schedule and ledger have not changed.`, committed: false, state: store.snapshot(), ledger: store.snapshot().ledger });
          }
          acceptedBy.push(memberId);
        }
        return await mutate(async () => {
          checkConsentWait();
          const current = store.snapshot();
          if (current.revision !== plan.revision) throw new Error('The household changed while consent was pending. Nothing was committed; request fresh options.');
          const next = applyPlan(current, plan, acceptedBy);
          await store.save(next);
          offeredPlans.clear();
          return result({ kind: 'commit', message: 'Agreed and saved. The schedule and fairness ledger will survive a server restart.', committed: true, state: next, ledger: next.ledger });
        });
      } catch (error) { return toolError(error); }
    });

    server.registerTool('report_change', {
      description: 'Record an actual event extension or cancellation. Replan only its affected conflict component; proposals still require fresh consent.',
      inputSchema: {
        activityId: z.string().min(1), change: z.enum(['extend', 'cancel']),
        minutes: z.number().int().min(15).max(180).refine(value => value % 15 === 0, 'Use 15-minute increments.').optional(),
      }, annotations: { readOnlyHint: false, destructiveHint: false },
    }, async ({ activityId, change, minutes }) => {
      try {
        return await mutate(async () => {
          const outcome = reportChange(store.snapshot(), activityId, change, minutes ?? 30);
          await store.save(outcome.state);
          offer(outcome.plans);
          const kept = outcome.state.agreements.filter(agreement => outcome.keptAgreementIds.includes(agreement.id));
          const keptMessage = kept.length ? ` Kept agreements: ${kept.map(agreement => agreement.title).join('; ')}.` : '';
          return result({ kind: 'change', message: `${outcome.plans.length ? 'The change is saved. Only the affected part needs a new agreement. Compare who yields next.' : 'The change is saved. No new agreement is needed.'}${keptMessage}`, state: outcome.state, ledger: outcome.state.ledger, plans: outcome.plans, conflicts: outcome.conflicts, affectedAgreementIds: outcome.affectedAgreementIds, keptAgreementIds: outcome.keptAgreementIds });
        });
      } catch (error) { return toolError(error); }
    });

    server.registerTool('reset_demo', {
      description: 'Restore the canonical fictional day and historical ledger. Removes demo agreements.',
      inputSchema: {}, annotations: { readOnlyHint: false, destructiveHint: true },
    }, async () => {
      try {
        return await mutate(async () => {
          const state = { ...createDemoState(), revision: store.snapshot().revision + 1 };
          await store.save(state);
          offeredPlans.clear();
          return result({ kind: 'reset', message: 'The fictional household is reset. Ask what is clashing today.', state, ledger: state.ledger });
        });
      } catch (error) { return toolError(error); }
    });

    server.registerResource('household-state', 'household://state', { mimeType: 'application/json', description: 'Fictional household schedule and agreements.' }, async uri => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(store.snapshot(), null, 2) }] }));
    server.registerResource('fairness-ledger', 'household://ledger', { mimeType: 'application/json', description: 'Fictional yields in the last 14 days: required, negotiated, and bounded effort points.' }, async uri => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(store.snapshot().ledger, null, 2) }] }));
    server.registerPrompt('resolve-household-fairly', {
      description: 'Mediate today without assuming consent or repeatedly burdening the same member.', argsSchema: {},
    }, async () => ({ messages: [{ role: 'user', content: { type: 'text', text: `For ${store.snapshot().date}, call get_household_state and get_fairness_ledger, then find_conflicts. Resolve one conflict group at a time with propose_plans; each proposal replaces the previous menu. Explain every concrete change and cumulative burden. Use commit_plan only after the user chooses; it must elicit each yielding member's explicit consent. Then find remaining conflicts again. Preserve unaffected agreements after report_change.` } }] }));
    return server;
  }

  app.all('/mcp', async (req, res) => {
    if (!['POST', 'GET', 'DELETE'].includes(req.method)) { res.setHeader('Allow', 'POST, GET, DELETE'); res.sendStatus(405); return; }
    const sessionId = req.get('mcp-session-id');
    try {
      await expireIdleSessions();
      const existing = sessionId ? sessions.get(sessionId) : undefined;
      if (existing) {
        touchSession(sessionId!);
        await existing.transport.handleRequest(req, res, req.body);
        touchSession(sessionId!);
        return;
      }
      if (sessionId) { res.status(404).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Session not found; reconnect to initialize.' }, id: null }); return; }
      if (req.method !== 'POST' || !isInitializeRequest(req.body)) {
        res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Initialize first; then provide Mcp-Session-Id.' }, id: null }); return;
      }
      // Serialize admission so simultaneous initializations cannot exceed the cap.
      const pending = sessionInitialization.then(async () => {
        if (sessions.size >= 64) {
          const oldestId = sessions.keys().next().value!;
          await closeSession(oldestId);
        }
        const server = makeServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: id => { sessions.set(id, { server, transport, lastActivity: Date.now() }); },
          onsessionclosed: id => closeSession(id),
        });
        try {
          await server.connect(transport);
          const sdkOnClose = transport.onclose;
          transport.onclose = () => { if (transport.sessionId) sessions.delete(transport.sessionId); sdkOnClose?.(); };
          await transport.handleRequest(req, res, req.body);
        } catch (error) {
          await server.close();
          throw error;
        }
      });
      sessionInitialization = pending.catch(() => undefined);
      await pending;
    } catch (error) {
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: error instanceof Error ? error.message : 'Transport error.' }, id: null });
    }
  });
  app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(400).json({ jsonrpc: '2.0', error: { code: -32700, message: 'Invalid request body.' }, id: null });
  });

  let listener: HttpServer | undefined;
  return {
    app,
    store,
    async listen(port = 3001) {
      listener = await new Promise<HttpServer>((accept, reject) => {
        const http = app.listen(port, '127.0.0.1', () => accept(http));
        http.once('error', reject);
      });
      const address = listener.address();
      if (!address || typeof address === 'string') throw new Error('No HTTP address.');
      return { port: address.port, url: `http://127.0.0.1:${address.port}/mcp` };
    },
    async close() {
      clearInterval(sessionExpiry);
      await Promise.allSettled([...sessions.values()].map(session => session.server.close()));
      sessions.clear();
      if (listener) {
        const http = listener;
        const closing = new Promise<void>((accept, reject) => http.close(error => error ? reject(error) : accept()));
        http.closeAllConnections();
        await closing;
      }
    },
  };
}
