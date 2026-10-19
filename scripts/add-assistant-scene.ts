import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Adds one scene before the closing segment of video/demo.mp4: Claude Code, an existing
// AI assistant, calls the same RoomLilt server over Streamable HTTP and reads the
// agreements made in the recording. Writes video/demo-assistant.mp4; demo.mp4 is unchanged.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve('data/browser-cache');
const raw = resolve('video/raw');
const build = resolve('video/build');
const input = resolve('video/demo.mp4');
const output = resolve('video/demo-assistant.mp4');
const port = 3011;
const titleCardSeconds = 2.5; // build-video.ts places a 2.5-second title card before the recording.
const holdSeconds = 3;
const narration = 'The same server also works from an existing AI assistant. Here, Claude Code connects over Streamable HTTP and reads the agreements we just made.';
const prompt = 'Use the roomlilt MCP server. What has this household agreed today, and what does the fairness ledger show now? Do not change anything. Reply in English in under 60 words.';
const tools = ['get_household_state', 'get_fairness_ledger', 'find_conflicts'];

function run(command: string, args: string[], options: { cwd?: string; timeout?: number } = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error?.message ?? result.stderr.trim()}`);
  return result;
}
function seconds(path: string) {
  const value = Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path]).stdout.trim());
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid duration: ${path}`);
  return value;
}
function normalize(source: string, target: string) {
  // Same two-pass EBU R128 target as scripts/synth-audio.ts.
  const first = run('ffmpeg', ['-hide_banner', '-nostdin', '-i', source, '-af', 'loudnorm=I=-18:TP=-2:LRA=7:print_format=json', '-f', 'null', '-']);
  const json = first.stderr.match(/\{\s*"input_i"[\s\S]*?\}/)?.[0];
  if (!json) throw new Error(`No loudness measurement for ${source}`);
  const m = JSON.parse(json) as Record<string, string>;
  const filter = `loudnorm=I=-18:TP=-2:LRA=7:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true,alimiter=limit=0.7943:level=false:latency=true`;
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', source, '-af', filter, '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', target]);
}
const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
function escape(text: string) {
  return text.replace(/[&<>"]/g, c => entities[c] ?? c);
}

async function startServer(dataFile: string) {
  const child = spawn('./node_modules/.bin/tsx', ['src/server/index.ts'], { env: { ...process.env, PORT: String(port), DATA_FILE: dataFile }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise<void>((ready, fail) => {
    let log = '';
    const timer = setTimeout(() => fail(new Error(`Server did not start on port ${port}: ${log}`)), 20000);
    const read = (chunk: Buffer) => { log += chunk.toString(); if (log.includes('ready at')) { clearTimeout(timer); ready(); } };
    child.stdout!.on('data', read);
    child.stderr!.on('data', read);
    child.on('exit', code => { clearTimeout(timer); fail(new Error(`Server exited (${code}) before it was ready: ${log}`)); });
  });
  return child;
}
function stopServer(child: ChildProcess | undefined) {
  if (child && child.exitCode === null) child.kill('SIGTERM');
}

type Run = { version: string; calls: { name: string; input: unknown }[]; answer: string };
function askClaudeCode(): Run {
  const config = resolve(raw, 'assistant.mcp.json');
  writeFileSync(config, JSON.stringify({ mcpServers: { roomlilt: { type: 'http', url: `http://127.0.0.1:${port}/mcp` } } }) + '\n');
  // A one-off --mcp-config leaves the assistant's saved configuration unchanged.
  const result = run('claude', ['-p', prompt, '--mcp-config', 'assistant.mcp.json', '--strict-mcp-config', '--setting-sources', 'project',
    '--allowedTools', tools.map(tool => `mcp__roomlilt__${tool}`).join(' '), '--output-format', 'stream-json', '--verbose', '--model', 'haiku'], { cwd: raw, timeout: 300000 });
  writeFileSync(resolve(raw, 'assistant.jsonl'), result.stdout);
  const rows = result.stdout.split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
  const init = rows.find(row => row.type === 'system' && row.subtype === 'init');
  if (!init?.mcp_servers?.some((server: { name: string; status: string }) => server.name === 'roomlilt' && server.status === 'connected')) throw new Error('Claude Code did not connect to the roomlilt server.');
  const calls = rows.filter(row => row.type === 'assistant').flatMap(row => row.message.content)
    .filter((part: { type: string; name?: string }) => part.type === 'tool_use' && part.name?.startsWith('mcp__roomlilt__'))
    .map((part: { name: string; input: unknown }) => ({ name: part.name.replace('mcp__roomlilt__', ''), input: part.input }));
  const final = rows.find(row => row.type === 'result');
  if (final?.subtype !== 'success' || final.is_error) throw new Error('Claude Code did not finish successfully.');
  const answer = String(final.result ?? '').trim();
  if (!calls.some(call => call.name === 'get_household_state') || !calls.some(call => call.name === 'get_fairness_ledger')) throw new Error('Claude Code did not read the household state and ledger.');
  if (!answer || /[^\x00-\x7F–—’“”…·]/.test(answer)) throw new Error(`Unexpected answer text: ${answer}`);
  return { version: String(init.claude_code_version ?? ''), calls, answer };
}

async function renderCard(result: Run, path: string) {
  const answer = escape(result.answer).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const calls = result.calls.map(call => `<li><span class="dot"></span><b>roomlilt</b> · ${escape(call.name)} <code>${escape(JSON.stringify(call.input))}</code></li>`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; width: 1280px; height: 800px; background: #f6f7ef; font-family: -apple-system, 'Helvetica Neue', sans-serif; color: #1d2b28; }
    .wrap { box-sizing: border-box; height: 800px; padding: 0 72px; display: flex; flex-direction: column; justify-content: center; }
    .eyebrow { font-size: 15px; letter-spacing: .14em; text-transform: uppercase; color: #5b6b66; }
    h1 { font-family: Georgia, serif; font-weight: 400; font-size: 44px; margin: 10px 0 26px; }
    .term { background: #1f302d; color: #e9efe6; border-radius: 22px; padding: 30px 38px; font-size: 20px; line-height: 1.5; }
    .meta { color: #9fb3ab; font-size: 16px; margin-bottom: 16px; }
    .label { color: #9fb3ab; font-size: 14px; letter-spacing: .12em; text-transform: uppercase; margin-top: 18px; }
    ul { list-style: none; padding: 0; margin: 6px 0 0; }
    li { font-family: Menlo, monospace; font-size: 18px; margin: 4px 0; }
    code { color: #b9c9c1; }
    .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: #8fc58a; margin-right: 10px; }
    .answer { font-size: 23px; margin-top: 6px; }
    .foot { margin-top: 20px; font-size: 15px; color: #5b6b66; }
  </style></head><body><div class="wrap">
    <div class="eyebrow">Same MCP server, another client</div>
    <h1>An existing AI assistant reads the same agreements.</h1>
    <div class="term">
      <div class="meta">Claude Code ${escape(result.version)} · non-interactive · MCP server “roomlilt” over Streamable HTTP · connected</div>
      <div class="label">Prompt</div><div>${escape(prompt)}</div>
      <div class="label">Tool calls</div><ul>${calls}</ul>
      <div class="label">Answer</div><div class="answer">${answer}</div>
    </div>
    <div class="foot">Rendered from this run's stream-json output. Same fictional household data as the end of this demo.</div>
  </div></body></html>`;
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.setContent(html);
    const overflow = await page.evaluate(() => document.documentElement.scrollHeight > 800);
    if (overflow) throw new Error('The scene card does not fit in 1280×800.');
    await page.screenshot({ path });
  } finally { await browser.close(); }
}

async function main() {
  if (!existsSync(input)) throw new Error('Missing video/demo.mp4. Run npm run video:build first.');
  const manifest = JSON.parse(readFileSync(resolve(raw, 'segments.json'), 'utf8')) as { dataFile: string; segments: { id: string; startMs: number }[] };
  const close = manifest.segments.find(segment => segment.id === 'close');
  if (!close) throw new Error('The recording has no closing segment.');
  mkdirSync(build, { recursive: true });
  // The recorder's data file holds the household exactly as the recording left it.
  const dataFile = resolve(raw, 'assistant-household.json');
  copyFileSync(resolve(manifest.dataFile), dataFile);
  let server: ChildProcess | undefined;
  let result: Run;
  try { server = await startServer(dataFile); result = askClaudeCode(); }
  finally { stopServer(server); }
  console.log(`Claude Code ${result.version} called: ${result.calls.map(call => call.name).join(', ')}`);
  console.log(`Answer: ${result.answer}`);
  const card = resolve(build, 'assistant-card.png');
  await renderCard(result, card);
  const voice = process.env.NARRATOR_MAC_VOICE?.trim() || 'Tom (Enhanced)';
  const speech = resolve(build, 'assistant-narration.aiff');
  const voiceTrack = resolve(build, 'assistant-narration.wav');
  run('say', ['-v', voice, '-o', speech, narration]);
  normalize(speech, voiceTrack);
  const lead = 0.4;
  const cardSeconds = Math.ceil((lead + seconds(voiceTrack) + holdSeconds) * 30) / 30;
  // Cut inside the pause before the closing narration, on a frame boundary.
  const cut = Math.floor((titleCardSeconds + close.startMs / 1000 - 0.2) * 30) / 30;
  const audio = 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=mono';
  const filter = [
    `[0:v]trim=end=${cut},setpts=PTS-STARTPTS,setsar=1[v1]`,
    `[0:v]trim=start=${cut},setpts=PTS-STARTPTS,setsar=1[v2]`,
    `[1:v]fps=30,format=yuv420p,setsar=1,trim=duration=${cardSeconds},setpts=PTS-STARTPTS[vc]`,
    `[0:a]atrim=end=${cut},asetpts=PTS-STARTPTS,${audio}[a1]`,
    `[0:a]atrim=start=${cut},asetpts=PTS-STARTPTS,${audio}[a2]`,
    `[2:a]${audio},adelay=${Math.round(lead * 1000)}:all=1,apad=whole_dur=${cardSeconds},atrim=end=${cardSeconds},asetpts=PTS-STARTPTS[ac]`,
    '[v1][a1][vc][ac][v2][a2]concat=n=3:v=1:a=1[v][a]',
  ].join(';');
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', input, '-loop', '1', '-framerate', '30', '-t', String(cardSeconds), '-i', card, '-i', voiceTrack,
    '-filter_complex', filter, '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '1', '-movflags', '+faststart', output]);
  const total = seconds(output);
  console.log(`video/demo-assistant.mp4: ${total.toFixed(3)} s; scene of ${cardSeconds.toFixed(3)} s inserted at ${cut.toFixed(3)} s.`);
  if (total >= 180) throw new Error('The video reaches 180 seconds.');
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
