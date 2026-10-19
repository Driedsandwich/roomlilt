import { mkdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { createApplication, PROTOCOL_VERSION } from '../src/server/app.js';
import type { ToolData } from '../src/shared/types.js';

type App = Awaited<ReturnType<typeof createApplication>>;
let app: App;
let endpoint: string;
let dataFile: string;
const connections: Array<{ client: Client; transport: StreamableHTTPClientTransport }> = [];

async function rawInitialize(protocolVersion: string) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion, capabilities: {}, clientInfo: { name: 'raw-integration', version: '1.0.0' },
    } }),
  });
  expect(response.status).toBe(200);
  const events = (await response.text()).split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)) as JSONRPCMessage);
  const initialized = events.find(message => 'result' in message);
  expect(initialized).toBeDefined();
  return {
    protocolVersion: initialized && 'result' in initialized ? initialized.result.protocolVersion : undefined,
    sessionId: response.headers.get('mcp-session-id')!,
  };
}

async function connect(action: 'accept' | 'decline' | 'cancel' = 'accept', supportConsent = true) {
  const traffic: JSONRPCMessage[] = [];
  const http: Array<{ method: string; status: number; contentType: string }> = [];
  const elicitedMembers: string[] = [];
  const client = new Client({ name: 'roomlilt-integration', version: '1.0.0' }, {
    capabilities: supportConsent ? { elicitation: { form: {} } } : {},
  });
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    fetch: async (input, init) => {
      const response = await fetch(input, init);
      http.push({ method: init?.method ?? 'GET', status: response.status, contentType: response.headers.get('content-type') ?? '' });
      return response;
    },
  });
  const start = transport.start.bind(transport);
  transport.start = async () => {
    const handler = transport.onmessage;
    transport.onmessage = message => { traffic.push(structuredClone(message)); handler?.(message); };
    await start();
  };
  if (supportConsent) client.setRequestHandler(ElicitRequestSchema, async request => {
    if (request.params.mode === 'url') throw new Error('Only form consent is supported.');
    const property = request.params.requestedSchema.properties.memberId;
    const memberId = 'enum' in property ? property.enum?.[0] : undefined;
    elicitedMembers.push(String(memberId));
    return action === 'accept' ? { action, content: { consent: true, memberId: String(memberId) } } : { action };
  });
  await client.connect(transport);
  connections.push({ client, transport });
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const response = await client.callTool({ name, arguments: args });
    if (response.isError) throw new Error(JSON.stringify(response.content));
    return response.structuredContent as unknown as ToolData;
  };
  return { client, transport, traffic, http, elicitedMembers, call };
}

beforeEach(async () => {
  await mkdir('data/tests', { recursive: true });
  dataFile = `data/tests/integration-${randomUUID()}.json`;
  app = await createApplication({ dataFile });
  endpoint = (await app.listen(0)).url;
});

afterEach(async () => {
  for (const { client, transport } of connections.splice(0)) {
    await transport.terminateSession().catch(() => undefined);
    await client.close().catch(() => undefined);
  }
  await app.close();
});

describe('real SDK client over stateful Streamable HTTP', () => {
  it.each([
    ['2025-11-25', '2025-11-25'],
    ['2026-07-28', '2025-11-25'],
    ['2025-03-26', '2025-03-26'],
  ])('negotiates a raw client requesting %s to %s through the SDK', async (requested, expected) => {
    const initialized = await rawInitialize(requested);
    expect(initialized.protocolVersion).toBe(expected);
    expect(initialized.sessionId).toBeTruthy();
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'Mcp-Session-Id': initialized.sessionId, 'MCP-Protocol-Version': expected };
    const ready = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
    expect(ready.status).toBe(202);
    const listed = await fetch(endpoint, {
      method: 'POST', headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });
    expect(listed.status).toBe(200);
    expect(await listed.text()).toContain('get_household_state');
  });

  it('negotiates 2025-11-25, advertises tools/resources/prompts, and manages a session', async () => {
    const { client, transport, traffic, http } = await connect();
    const initialized = traffic.find(message => 'result' in message && (message.result as Record<string, unknown>).protocolVersion);
    expect(initialized && 'result' in initialized ? initialized.result.protocolVersion : undefined).toBe(PROTOCOL_VERSION);
    expect(transport.sessionId).toBeTruthy();
    expect((await client.listTools()).tools.map(tool => tool.name)).toEqual(expect.arrayContaining([
      'get_household_state', 'find_conflicts', 'propose_plans', 'commit_plan', 'report_change', 'get_fairness_ledger', 'reset_demo',
    ]));
    expect((await client.listResources()).resources.map(resource => resource.uri)).toEqual(['household://state', 'household://ledger']);
    const resource = await client.readResource({ uri: 'household://state' });
    expect(JSON.parse('text' in resource.contents[0] ? resource.contents[0].text : '{}').fictional).toBe(true);
    expect((await client.listPrompts()).prompts).toHaveLength(1);
    expect((await client.getPrompt({ name: 'resolve-household-fairly' })).messages[0].content).toMatchObject({ type: 'text' });
    const response = await fetch(endpoint, { method: 'GET', headers: { Accept: 'text/event-stream', 'Mcp-Session-Id': transport.sessionId!, 'MCP-Protocol-Version': PROTOCOL_VERSION } });
    // The SDK already holds the single allowed standalone GET stream.
    expect(http).toContainEqual({ method: 'GET', status: 200, contentType: 'text/event-stream' });
    expect(response.status).toBe(409);
    await response.body?.cancel();
    const sessionId = transport.sessionId!;
    await transport.terminateSession();
    const expired = await fetch(endpoint, { method: 'DELETE', headers: { 'Mcp-Session-Id': sessionId } });
    expect(expired.status).toBe(404);
  });

  it.each(['decline', 'cancel'] as const)('%s leaves schedule, ledger, and disk unchanged', async action => {
    const { call, elicitedMembers } = await connect(action);
    const before = (await call('get_household_state')).state!;
    const conflicts = (await call('find_conflicts', { date: before.date })).conflicts!;
    const plans = (await call('propose_plans', { conflictId: conflicts[0].id })).plans!;
    const diskBefore = await readFile(dataFile, 'utf8');
    const outcome = await call('commit_plan', { planId: plans[0].id });
    expect(outcome.committed).toBe(false);
    expect(elicitedMembers).toContain('sam');
    expect((await call('get_household_state')).state).toEqual(before);
    expect(await readFile(dataFile, 'utf8')).toBe(diskBefore);
  });

  it('runs the full demo, reloads saved consent after restart, and replans only the affected part', async () => {
    const first = await connect();
    const initial = (await first.call('get_household_state')).state!;
    const conflicts = (await first.call('find_conflicts', { date: initial.date })).conflicts!;
    const morningConflict = conflicts.find(conflict => conflict.activityIds.includes('sam-laundry'))!;
    const plans = (await first.call('propose_plans', { conflictId: morningConflict.id })).plans!;
    expect(plans.length).toBeGreaterThanOrEqual(2);
    expect(plans.length).toBeLessThanOrEqual(3);
    const morningPlan = plans.find(plan => plan.recommended)!;
    const committed = await first.call('commit_plan', { planId: morningPlan.id });
    expect(committed.committed).toBe(true);
    expect(first.elicitedMembers).toEqual(morningPlan.yieldingMemberIds);
    const morning = committed.state!;
    const laundry = morning.activities.find(activity => activity.id === 'sam-laundry')!;
    expect(laundry.start).toBe(14 * 60);
    const laundryAgreements = morning.agreements.filter(agreement => agreement.changes.some(change => change.activityId === 'sam-laundry'));
    expect(laundryAgreements.length).toBeGreaterThan(0);
    expect(morningPlan.changes.every(change => change.yieldType === 'required')).toBe(true);
    const initialSam = initial.ledger.find(entry => entry.memberId === 'sam')!;
    expect(morning.ledger.find(entry => entry.memberId === 'sam')).toMatchObject({
      yieldCount: initialSam.yieldCount + 1,
      requiredYields: initialSam.requiredYields + 1,
      negotiatedYields: initialSam.negotiatedYields,
    });

    const eveningConflict = (await first.call('find_conflicts')).conflicts!.find(conflict => conflict.activityIds.includes('sam-game'))!;
    const eveningPlans = (await first.call('propose_plans', { conflictId: eveningConflict.id })).plans!;
    expect(eveningPlans.length).toBeGreaterThanOrEqual(2);
    expect(eveningPlans.length).toBeLessThanOrEqual(3);
    const fairest = eveningPlans.find(plan => plan.recommended)!;
    const leastDisruption = eveningPlans.find(plan => plan.badges.includes('Lowest disruption'))!;
    expect(fairest.badges).toContain('Fairest');
    expect(fairest.yieldingMemberIds).toEqual(['leo']);
    expect(leastDisruption.yieldingMemberIds).toEqual(['sam']);
    expect(leastDisruption.disruptionScore).toBeLessThan(fairest.disruptionScore);
    expect(fairest.score).toBeLessThan(leastDisruption.score);
    expect(fairest.reason).toContain('Sam');
    expect(fairest.reason).toContain('9');
    expect(fairest.reason).toContain('Leo');
    expect(fairest.changes.every(change => change.yieldType === 'negotiated')).toBe(true);
    const eveningCommitted = await first.call('commit_plan', { planId: fairest.id });
    expect(eveningCommitted.committed).toBe(true);
    expect(first.elicitedMembers).toEqual([...morningPlan.yieldingMemberIds, ...fairest.yieldingMemberIds]);
    const saved = eveningCommitted.state!;
    const eveningAgreements = saved.agreements.filter(agreement => agreement.changes.some(change => change.activityId === 'leo-reading'));
    expect(eveningAgreements).toHaveLength(1);
    const keptAgreements = [...laundryAgreements, ...eveningAgreements];
    expect((await first.call('find_conflicts')).conflicts).toEqual([]);
    await first.transport.terminateSession();
    await first.client.close();
    connections.splice(0, 1);
    await app.close();
    app = await createApplication({ dataFile });
    endpoint = (await app.listen(0)).url;
    const second = await connect();
    expect((await second.call('get_household_state')).state).toEqual(saved);
    const changed = await second.call('report_change', { activityId: 'leo-meeting', change: 'extend', minutes: 30 });
    expect(changed.plans!.length).toBeGreaterThanOrEqual(2);
    expect(changed.keptAgreementIds).toEqual(expect.arrayContaining(keptAgreements.map(agreement => agreement.id)));
    expect(changed.state!.activities.find(activity => activity.id === 'sam-laundry')).toEqual(laundry);
    expect(changed.state!.activities.filter(activity => ['sam-game', 'leo-reading'].includes(activity.id))).toEqual(saved.activities.filter(activity => ['sam-game', 'leo-reading'].includes(activity.id)));
    for (const agreement of keptAgreements) {
      expect(changed.state!.agreements.find(item => item.id === agreement.id)).toEqual(agreement);
      expect(changed.message).toContain(agreement.title);
    }
    const repairPlan = changed.plans!.find(plan => plan.recommended)!;
    expect(repairPlan.yieldingMemberIds).toContain('leo');
    expect(repairPlan.changes.some(change => ['sam-laundry', 'sam-game', 'leo-reading'].includes(change.activityId))).toBe(false);
    const repaired = await second.call('commit_plan', { planId: repairPlan.id });
    expect(repaired.committed).toBe(true);
    expect(second.elicitedMembers).toContain('leo');
    for (const agreement of keptAgreements) expect(repaired.state!.agreements.find(item => item.id === agreement.id)).toEqual(agreement);
    expect((await second.call('find_conflicts')).conflicts).toEqual([]);
    expect((await second.call('get_fairness_ledger')).ledger).toEqual(repaired.state!.ledger);
    const reset = await second.call('reset_demo');
    expect(reset.state!.agreements).toEqual([]);
    expect(reset.state!.ledger).toEqual(initial.ledger);
    expect(reset.state!.activities).toEqual(initial.activities);
  });

  it('refuses commits without form support and stale menu selections', async () => {
    const noForm = await connect('accept', false);
    const conflicts = (await noForm.call('find_conflicts')).conflicts!;
    const plans = (await noForm.call('propose_plans', { conflictId: conflicts[0].id })).plans!;
    await expect(noForm.call('commit_plan', { planId: plans[0].id })).rejects.toThrow(/form elicitation/);
    const other = await connect();
    await other.call('reset_demo');
    const stale = await noForm.client.callTool({ name: 'commit_plan', arguments: { planId: plans[0].id } });
    expect(stale.isError).toBe(true);
  });

  it('invalidates a pending consent if another session changes the household', async () => {
    const pending = await connect();
    const other = await connect();
    let reached!: () => void;
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { reached = resolve; });
    const proceed = new Promise<void>(resolve => { release = resolve; });
    pending.client.setRequestHandler(ElicitRequestSchema, async () => {
      reached(); await proceed;
      return { action: 'accept', content: { consent: true, memberId: 'sam' } };
    });
    const conflict = (await pending.call('find_conflicts')).conflicts![0];
    const plan = (await pending.call('propose_plans', { conflictId: conflict.id })).plans![0];
    const commit = pending.client.callTool({ name: 'commit_plan', arguments: { planId: plan.id } });
    await waiting;
    const reset = await other.call('reset_demo');
    release();
    const answer = await commit;
    expect(answer.isError).toBe(true);
    expect((await other.call('get_household_state')).state).toEqual(reset.state);
  });

  it('rejects remote origins, foreign hosts, unsupported request versions, and missing sessions', async () => {
    for (const method of ['POST', 'GET', 'DELETE']) {
      expect((await fetch(endpoint, { method, headers: { Origin: 'https://untrusted.example' } })).status).toBe(403);
    }
    expect((await fetch(endpoint, { method: 'POST', headers: { Origin: 'null' } })).status).toBe(403);
    // Node fetch normalizes Host; use a real Node HTTP request to send a foreign Host.
    const foreignHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(endpoint, { method: 'POST', headers: { Host: 'untrusted.example' } }, response => { response.resume(); resolve(response.statusCode); });
      request.on('error', reject);
      request.end();
    });
    expect(foreignHostStatus).toBe(403);
    const { transport } = await connect();
    expect((await fetch(endpoint, { method: 'POST', headers: {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
      'Mcp-Session-Id': transport.sessionId!, 'MCP-Protocol-Version': '1900-01-01',
    }, body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list' }) })).status).toBe(400);
    expect((await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })).status).toBe(400);
  });
});
