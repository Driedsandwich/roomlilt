import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ElicitRequestSchema, type ElicitRequest, type ElicitResult, type JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { ToolData } from '../shared/types.js';

export interface ProtocolEntry { direction: 'sent' | 'received'; message: JSONRPCMessage | JSONRPCMessage[]; time: string }
export interface ConnectionInfo { protocolVersion: string; sessionId: string; toolNames: string[] }

export class HouseholdClient {
  private client?: Client;
  private transport?: StreamableHTTPClientTransport;
  constructor(
    private readonly onTraffic: (entry: ProtocolEntry) => void,
    private readonly onElicitation: (request: ElicitRequest, signal?: AbortSignal) => Promise<ElicitResult>,
    private readonly onDisconnect: () => void,
  ) {}

  async connect(): Promise<ConnectionInfo> {
    await this.close();
    const client = new Client({ name: 'roomlilt-display', version: '1.0.0' }, { capabilities: { elicitation: { form: {} } } });
    const transport = new StreamableHTTPClientTransport(new URL('/mcp', window.location.origin), {
      reconnectionOptions: { maxRetries: 2, initialReconnectionDelay: 1000, maxReconnectionDelay: 3000, reconnectionDelayGrowFactor: 1.5 },
    });
    let protocolVersion = '';
    let ready = false;
    const log = (direction: ProtocolEntry['direction'], message: ProtocolEntry['message']) => {
      this.onTraffic({ direction, message, time: new Date().toLocaleTimeString('en-GB', { hour12: false }) });
      if (direction === 'received' && !Array.isArray(message) && 'result' in message && typeof message.result.protocolVersion === 'string') {
        protocolVersion = message.result.protocolVersion;
      }
    };
    const originalSend = transport.send.bind(transport);
    transport.send = async (message, options) => {
      log('sent', message);
      await originalSend(message, options);
    };
    // Protocol.connect installs its own handler before calling start. Preserve it.
    const originalStart = transport.start.bind(transport);
    transport.start = async () => {
      const protocolHandler = transport.onmessage;
      transport.onmessage = (message) => {
        log('received', message);
        protocolHandler?.(message);
      };
      await originalStart();
    };
    client.setRequestHandler(ElicitRequestSchema, (request, extra) => this.onElicitation(request, extra.signal));
    client.onclose = () => { if (this.client === client) this.onDisconnect(); };
    client.onerror = (error) => {
      if (ready && this.client === client && /stream disconnected|fetch|session|error (?:get|post)ing|failed to reconnect|network|ECONN/i.test(error.message)) {
        this.onDisconnect();
        void this.close();
      }
    };
    this.client = client;
    this.transport = transport;
    try {
      await client.connect(transport);
      if (protocolVersion !== '2025-11-25') throw new Error(`Required protocol 2025-11-25; server negotiated ${protocolVersion || 'an unknown version'}.`);
      const tools = await client.listTools();
      ready = true;
      return { protocolVersion, sessionId: transport.sessionId || '', toolNames: tools.tools.map((tool) => tool.name) };
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  async call(name: string, args: Record<string, unknown> = {}): Promise<ToolData> {
    if (!this.client) throw new Error('The local server is disconnected. Reconnect to continue.');
    const result = await this.client.callTool({ name, arguments: args }, undefined, { timeout: 180000 });
    if (result.isError) {
      const content = result.content as Array<{ type: string; text?: string }>;
      throw new Error(content.filter((item) => item.type === 'text').map((item) => item.text).join('\n') || 'The tool could not complete this request.');
    }
    const data = result.structuredContent as unknown as ToolData | undefined;
    if (!data || typeof data.kind !== 'string' || typeof data.message !== 'string') throw new Error('The server returned an unexpected result. Please reconnect.');
    return data;
  }

  async close(): Promise<void> {
    const client = this.client;
    const transport = this.transport;
    this.client = undefined;
    this.transport = undefined;
    if (transport?.sessionId) await transport.terminateSession().catch(() => undefined);
    if (client) await client.close().catch(() => undefined);
  }
}
