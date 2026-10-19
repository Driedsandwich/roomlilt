import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const cardSeconds = 2.5;
type Clip = { file: string; durationMs: number };
type AudioSegment = { id: string; narrator: Clip | null; assistant: Clip | null; durationMs: number };
type RecordedSegment = { id: string; startMs: number; endMs: number };
type Recording = { videoFile: string; segments: RecordedSegment[]; durationMs: number; width: number; height: number };
function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error?.message ?? result.stderr.trim()}`);
  return result;
}
function localFile(path: string) {
  if (typeof path !== 'string' || isAbsolute(path)) throw new Error('Media paths must be project-relative.');
  const full = realpathSync(resolve(root, path));
  const rel = relative(root, full);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`Path escapes project: ${path}`);
  return full;
}
function probe(file: string) {
  const result = JSON.parse(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height,codec_name', '-of', 'json', file]).stdout);
  const seconds = Number(result.format?.duration);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`Invalid media duration: ${file}`);
  return { seconds, streams: result.streams as { codec_type: string; width?: number; height?: number; codec_name?: string }[] };
}
function finite(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${label}`);
}

// A tiny local bitmap typeface keeps title rendering independent of optional
// ffmpeg drawtext/font libraries or a browser. No external media is downloaded.
const glyphs: Record<string, string> = {
  A:'01110/10001/10001/11111/10001/10001/10001', B:'11110/10001/10001/11110/10001/10001/11110',
  C:'01111/10000/10000/10000/10000/10000/01111', D:'11110/10001/10001/10001/10001/10001/11110',
  E:'11111/10000/10000/11110/10000/10000/11111', F:'11111/10000/10000/11110/10000/10000/10000',
  G:'01111/10000/10000/10111/10001/10001/01111', H:'10001/10001/10001/11111/10001/10001/10001',
  I:'11111/00100/00100/00100/00100/00100/11111', J:'00111/00010/00010/00010/10010/10010/01100',
  K:'10001/10010/10100/11000/10100/10010/10001', L:'10000/10000/10000/10000/10000/10000/11111',
  M:'10001/11011/10101/10101/10001/10001/10001', N:'10001/11001/10101/10011/10001/10001/10001',
  O:'01110/10001/10001/10001/10001/10001/01110', P:'11110/10001/10001/11110/10000/10000/10000',
  Q:'01110/10001/10001/10001/10101/10010/01101', R:'11110/10001/10001/11110/10100/10010/10001',
  S:'01111/10000/10000/01110/00001/00001/11110', T:'11111/00100/00100/00100/00100/00100/00100',
  U:'10001/10001/10001/10001/10001/10001/01110', V:'10001/10001/10001/10001/10001/01010/00100',
  W:'10001/10001/10001/10101/10101/10101/01010', X:'10001/10001/01010/00100/01010/10001/10001',
  Y:'10001/10001/01010/00100/00100/00100/00100', Z:'11111/00001/00010/00100/01000/10000/11111',
  ' ':'00000/00000/00000/00000/00000/00000/00000', '.':'00000/00000/00000/00000/00000/00100/00100',
  '+':'00000/00100/00100/11111/00100/00100/00000', '-':'00000/00000/00000/11111/00000/00000/00000',
};
function card(path: string, width: number, height: number, lines: { text: string; y: number; scale: number }[]) {
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < pixels.length; i += 3) { pixels[i] = 15; pixels[i + 1] = 37; pixels[i + 2] = 39; }
  for (const line of lines) {
    const text = line.text.toUpperCase();
    const scale = line.scale;
    const x0 = Math.floor((width - (text.length * 6 - 1) * scale) / 2);
    if (x0 < 0) throw new Error(`Card text is too wide: ${text}`);
    [...text].forEach((char, index) => {
      const rows = glyphs[char]?.split('/');
      if (!rows) throw new Error(`No bitmap glyph for ${char}`);
      rows.forEach((row, y) => [...row].forEach((on, x) => {
        if (on !== '1') return;
        for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
          const px = x0 + index * 6 * scale + x * scale + dx;
          const py = line.y + y * scale + dy;
          if (py >= height) throw new Error('Card text exceeds frame height.');
          const offset = (py * width + px) * 3;
          pixels[offset] = 238; pixels[offset + 1] = 245; pixels[offset + 2] = 235;
        }
      }));
    });
  }
  writeFileSync(path, Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), pixels]));
}
function main() {
  if (process.argv.slice(2).some(arg => arg !== '--validate')) throw new Error('Usage: sh scripts/build-video.sh [--validate]');
  const recording: Recording = JSON.parse(readFileSync(localFile('video/raw/segments.json'), 'utf8'));
  const audio: { segments: AudioSegment[] } = JSON.parse(readFileSync(localFile('video/audio/timeline.json'), 'utf8'));
  const narration: { id: string }[] = JSON.parse(readFileSync(localFile('video/narration.json'), 'utf8'));
  const rawFile = localFile(recording.videoFile);
  const raw = probe(rawFile);
  const video = raw.streams.find(stream => stream.codec_type === 'video');
  if (!video || video.width !== recording.width || video.height !== recording.height || !((recording.width === 1280 && recording.height === 800) || (recording.width === 1920 && recording.height === 1200))) throw new Error('Raw video and manifest must have matching 1280x800 or 1920x1200 dimensions.');
  if (!Array.isArray(audio.segments) || !Array.isArray(recording.segments) || !Array.isArray(narration) || narration.length === 0 || audio.segments.length !== narration.length || recording.segments.length !== narration.length) throw new Error('Narration, audio, and recording segment counts must match.');
  finite(recording.durationMs, 'recording duration');
  let previousEnd = 0;
  const ids = new Set<string>();
  const clips: { file: string; startSeconds: number }[] = [];
  narration.forEach((row, i) => {
    const recorded = recording.segments[i];
    const spoken = audio.segments[i];
    if (ids.has(row.id) || row.id !== recorded.id || row.id !== spoken.id) throw new Error(`Duplicate or mismatched segment at index ${i}`);
    ids.add(row.id);
    finite(recorded.startMs, `${row.id} start`); finite(recorded.endMs, `${row.id} end`); finite(spoken.durationMs, `${row.id} audio duration`);
    if (recorded.startMs < previousEnd || recorded.endMs <= recorded.startMs) throw new Error(`Overlapping or reversed segment: ${row.id}`);
    let offsetMs = 0;
    for (const clip of [spoken.narrator, spoken.assistant]) {
      if (!clip) continue;
      finite(clip.durationMs, `${row.id} clip duration`);
      const file = localFile(clip.file);
      const actual = probe(file);
      if (!actual.streams.some(stream => stream.codec_type === 'audio') || Math.abs(actual.seconds * 1000 - clip.durationMs) > 40) throw new Error(`Audio duration changed; rerun synthesis and recording: ${clip.file}`);
      clips.push({ file, startSeconds: cardSeconds + (recorded.startMs + offsetMs) / 1000 });
      offsetMs += clip.durationMs;
    }
    if (spoken.durationMs < offsetMs || recorded.endMs - recorded.startMs + 50 < spoken.durationMs) throw new Error(`Segment does not hold its audio plus tail: ${row.id}`);
    previousEnd = recorded.endMs;
  });
  if (!clips.length) throw new Error('No audio clips found.');
  if (recording.durationMs + 100 < previousEnd) throw new Error('Recording duration ends before its final segment.');
  const bodySeconds = Math.max(raw.seconds, recording.durationMs / 1000, previousEnd / 1000);
  if (bodySeconds - raw.seconds > 2) throw new Error('Raw video is more than 2 s shorter than its timing manifest. Re-record.');
  const finalSeconds = bodySeconds + cardSeconds * 2;
  if (finalSeconds >= 180) throw new Error(`Predicted final duration ${finalSeconds.toFixed(3)} s reaches 180 s. Shorten and re-record.`);
  console.log(`Validated ${clips.length} clips across ${narration.length} segments; raw ${raw.seconds.toFixed(3)} s; final approximately ${finalSeconds.toFixed(3)} s.`);
  if (process.argv.includes('--validate')) return;
  const build = resolve(root, 'video/build');
  mkdirSync(build, { recursive: true });
  const title = resolve(build, 'title.ppm');
  const end = resolve(build, 'end.ppm');
  const ratio = recording.width / 1280;
  card(title, recording.width, recording.height, [
    { text: 'RoomLilt', y: Math.round(280 * ratio), scale: Math.round(12 * ratio) },
    { text: 'FAIR PLANS. EXPLICIT CONSENT.', y: Math.round(440 * ratio), scale: Math.round(4 * ratio) },
  ]);
  card(end, recording.width, recording.height, [
    { text: 'RoomLilt', y: Math.round(220 * ratio), scale: Math.round(10 * ratio) },
    { text: 'SIMULATED ALEXA+ STYLE EXPERIENCE', y: Math.round(390 * ratio), scale: Math.round(4 * ratio) },
    { text: 'FICTIONAL DATA', y: Math.round(470 * ratio), scale: Math.round(4 * ratio) },
    { text: 'NOT AFFILIATED WITH AMAZON', y: Math.round(540 * ratio), scale: Math.round(4 * ratio) },
  ]);
  const args = ['-hide_banner', '-loglevel', 'warning', '-nostdin', '-y', '-i', rawFile,
    '-loop', '1', '-framerate', '30', '-t', String(cardSeconds), '-i', title,
    '-loop', '1', '-framerate', '30', '-t', String(cardSeconds), '-i', end];
  for (const clip of clips) args.push('-i', clip.file);
  const filters = [
    `[1:v]fps=30,format=yuv420p,setsar=1,settb=AVTB,setpts=PTS-STARTPTS[title]`,
    `[0:v]fps=30,tpad=stop_mode=clone:stop_duration=${Math.max(0, bodySeconds - raw.seconds).toFixed(6)},trim=duration=${bodySeconds.toFixed(6)},format=yuv420p,setsar=1,settb=AVTB,setpts=PTS-STARTPTS[body]`,
    '[2:v]fps=30,format=yuv420p,setsar=1,settb=AVTB,setpts=PTS-STARTPTS[end]',
    '[title][body][end]concat=n=3:v=1:a=0[v]',
  ];
  clips.forEach((clip, i) => filters.push(`[${i + 3}:a]aresample=48000,aformat=channel_layouts=mono,asetpts=PTS-STARTPTS,adelay=${Math.round(clip.startSeconds * 1000)}:all=1[a${i}]`));
  filters.push(`${clips.map((_, i) => `[a${i}]`).join('')}amix=inputs=${clips.length}:normalize=0:dropout_transition=0,alimiter=limit=0.7943:level=false:latency=true,apad=whole_dur=${finalSeconds.toFixed(6)},atrim=duration=${finalSeconds.toFixed(6)}[a]`);
  const output = resolve(root, 'video/demo.mp4');
  args.push('-filter_complex', filters.join(';'), '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-t', finalSeconds.toFixed(6), '-movflags', '+faststart', output);
  run('ffmpeg', args);
  const final = probe(output);
  console.log(`video/demo.mp4: ${final.seconds.toFixed(3)} s (H.264/AAC, ${recording.width}x${recording.height}).`);
  if (final.seconds >= 180) throw new Error('Final output reaches 180 seconds; do not submit.');
  if (!final.streams.some(stream => stream.codec_name === 'h264') || !final.streams.some(stream => stream.codec_name === 'aac')) throw new Error('Final output is missing required H.264/AAC streams.');
}
try { main(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
