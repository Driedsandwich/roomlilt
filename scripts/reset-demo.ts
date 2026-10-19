import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { HouseholdStore } from '../src/domain/store.js';
import { localDataPath } from '../src/server/app.js';

const port = Number(process.env.PORT ?? 3001);
const health = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) }).catch((error: unknown) => {
  if (error instanceof TypeError && (error.cause as NodeJS.ErrnoException | undefined)?.code === 'ECONNREFUSED') return undefined;
  throw error;
});
if (health) {
  const identity = await health.json().catch(() => undefined);
  if (!health.ok || identity?.name !== 'roomlilt' || identity?.protocolVersion !== '2025-11-25') throw new Error('The process at this port is not the expected RoomLilt server. No reset was performed.');
  const client = new Client({ name: 'roomlilt-reset', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));
  try {
    await client.connect(transport);
    const response = await client.callTool({ name: 'reset_demo', arguments: {} });
    if (response.isError) throw new Error(JSON.stringify(response.content));
    console.log('Canonical fictional demo restored through the running MCP server.');
  } finally { await transport.terminateSession().catch(() => undefined); await client.close(); }
} else {
  const store = new HouseholdStore(localDataPath(process.env.DATA_FILE));
  await store.reset();
  console.log('Canonical fictional demo saved to the local data file.');
}
