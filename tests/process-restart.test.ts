import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { afterEach, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { ToolData } from '../src/shared/types.js';

let processHandle: ChildProcess | undefined;
async function startServer(dataFile: string) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], {
    cwd: process.cwd(), env: { ...process.env, PORT: '0', DATA_FILE: dataFile }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  processHandle = child;
  return await new Promise<string>((resolve, reject) => {
    let output = '';
    let errors = '';
    const timeout = setTimeout(() => reject(new Error(`Server startup timed out. ${errors}`)), 10000);
    child.stdout!.on('data', chunk => {
      output += chunk;
      const match = output.match(/ready at (http:\/\/127\.0\.0\.1:\d+\/mcp)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
    child.stderr!.on('data', chunk => { errors += chunk; });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); if (!output.includes('ready at')) reject(new Error(`Server exited ${code}. ${errors}`)); });
  });
}
async function stopServer() {
  const child = processHandle;
  if (!child || child.exitCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  await exited;
  processHandle = undefined;
}
afterEach(stopServer);

it('preserves consented plans and ledger across an actual Node server process restart', async () => {
  const dataFile = `data/tests/process-${randomUUID()}.json`;
  const first = new Client({ name: 'process-restart-test', version: '1.0.0' }, { capabilities: { elicitation: { form: {} } } });
  const firstTransport = new StreamableHTTPClientTransport(new URL(await startServer(dataFile)));
  first.setRequestHandler(ElicitRequestSchema, async () => ({ action: 'accept', content: { consent: true, memberId: 'sam' } }));
  await first.connect(firstTransport);
  const conflicts = (await first.callTool({ name: 'find_conflicts' })).structuredContent as unknown as ToolData;
  const proposals = (await first.callTool({ name: 'propose_plans', arguments: { conflictId: conflicts.conflicts![0].id } })).structuredContent as unknown as ToolData;
  const committed = (await first.callTool({ name: 'commit_plan', arguments: { planId: proposals.plans![0].id } })).structuredContent as unknown as ToolData;
  expect(committed.committed).toBe(true);
  await firstTransport.terminateSession();
  await first.close();
  await stopServer();
  const second = new Client({ name: 'process-restart-test', version: '1.0.0' });
  const secondTransport = new StreamableHTTPClientTransport(new URL(await startServer(dataFile)));
  try {
    await second.connect(secondTransport);
    const restored = (await second.callTool({ name: 'get_household_state' })).structuredContent as unknown as ToolData;
    expect(restored.state).toEqual(committed.state);
    expect(restored.state!.agreements.length).toBeGreaterThan(0);
  } finally { await secondTransport.terminateSession(); await second.close(); }
});
