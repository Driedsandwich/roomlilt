import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const audioDir = resolve(root, 'video/audio');
const manifest = resolve(audioDir, 'timeline.json');
type Narration = { id: string; narrator: string; assistant: string };
type Clip = { file: string; durationMs: number };
function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error?.message ?? result.stderr.trim()}`);
  return result;
}
function localExisting(path: string) {
  const full = realpathSync(resolve(root, path));
  const rel = relative(root, full);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`Path escapes project: ${path}`);
  return full;
}
function duration(path: string) {
  const seconds = Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', path]).stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`Invalid audio duration: ${path}`);
  return Math.ceil(seconds * 1000);
}
function normalize(input: string, output: string) {
  // Two-pass EBU R128 normalization gives both voices the same target loudness.
  const first = run('ffmpeg', ['-hide_banner', '-nostdin', '-i', input, '-af', 'loudnorm=I=-18:TP=-2:LRA=7:print_format=json', '-f', 'null', '-']);
  const json = first.stderr.match(/\{\s*"input_i"[\s\S]*?\}/)?.[0];
  if (!json) throw new Error(`No loudness measurement for ${input}`);
  const measured = JSON.parse(json) as Record<string, string>;
  for (const key of ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset']) {
    if (!Number.isFinite(Number(measured[key]))) throw new Error(`Invalid loudness measurement for ${input}: ${key}`);
  }
  const filter = `loudnorm=I=-18:TP=-2:LRA=7:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true,alimiter=limit=0.7943:level=false:latency=true`;
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', input, '-af', filter, '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', output]);
}
function main() {
  if (process.argv.length > 2) throw new Error('Usage: sh scripts/synth-audio.sh');
  mkdirSync(audioDir, { recursive: true });
  localExisting('video/audio');
  if (existsSync(manifest)) unlinkSync(manifest); // Never leave a stale ready-to-record manifest after failure.
  const rows: Narration[] = JSON.parse(readFileSync(localExisting('video/narration.json'), 'utf8'));
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('Narration must be a nonempty ordered array.');
  const ids = new Set<string>();
  for (const row of rows) {
    if (!/^[a-zA-Z0-9_-]+$/.test(row.id) || ids.has(row.id)) throw new Error(`Invalid or duplicate segment id: ${row.id}`);
    ids.add(row.id);
    if (typeof row.narrator !== 'string' || typeof row.assistant !== 'string') throw new Error(`Missing voice text: ${row.id}`);
  }
  run('ffprobe', ['-version']);
  run('ffmpeg', ['-version']);
  // Local Kokoro speech synthesis (Apache-2.0 weights); no network speech service is used.
  // macOS system voices are not used: their license limits them to personal, non-commercial use.
  const python = process.env.KOKORO_PYTHON?.trim() || 'python3';
  const model = resolve(root, process.env.KOKORO_MODEL?.trim() || 'data/tts/kokoro-v1.0.fp16.onnx');
  const voices = resolve(root, process.env.KOKORO_VOICES?.trim() || 'data/tts/voices-v1.0.bin');
  for (const file of [model, voices]) {
    if (!existsSync(file)) throw new Error(`Kokoro file not found: ${relative(root, file)}. See video/README.md for the download, or set KOKORO_MODEL / KOKORO_VOICES.`);
  }
  const narratorVoice = process.env.KOKORO_NARRATOR_VOICE?.trim() || 'am_michael';
  const assistantVoice = process.env.KOKORO_ASSISTANT_VOICE?.trim() || 'af_heart';
  const speed = Number(process.env.KOKORO_SPEED ?? 1.1);
  if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) throw new Error('KOKORO_SPEED must be between 0.5 and 2.');
  const jobs: { text: string; voice: string; speed: number; out: string }[] = [];
  const planned = rows.map(row => {
    function plan(role: 'narrator' | 'assistant') {
      const line = row[role].trim();
      if (!line) return null;
      const source = resolve(audioDir, `${row.id}-${role}-source.wav`);
      jobs.push({ text: line, voice: role === 'narrator' ? narratorVoice : assistantVoice, speed, out: source });
      return { source, output: resolve(audioDir, `${row.id}-${role}.wav`) };
    }
    return { id: row.id, narrator: plan('narrator'), assistant: plan('assistant') };
  });
  const jobsFile = resolve(audioDir, 'kokoro-jobs.json');
  writeFileSync(jobsFile, JSON.stringify(jobs, null, 2) + '\n');
  run(python, [resolve(root, 'scripts/kokoro-tts.py'), model, voices, jobsFile]);
  unlinkSync(jobsFile);
  const segments = planned.map(row => {
    function finish(role: 'narrator' | 'assistant', paths: { source: string; output: string } | null): Clip | null {
      if (!paths) return null;
      duration(paths.source); // Reject a missing or empty synthesis result before normalizing.
      normalize(paths.source, paths.output);
      unlinkSync(paths.source);
      const clip = { file: relative(root, paths.output).split(sep).join('/'), durationMs: duration(paths.output) };
      console.log(`${row.id} ${role}: ${clip.durationMs} ms`);
      return clip;
    }
    const narrator = finish('narrator', row.narrator);
    const assistant = finish('assistant', row.assistant);
    return { id: row.id, narrator, assistant, durationMs: (narrator?.durationMs ?? 0) + (assistant?.durationMs ?? 0) + 800 };
  });
  const timeline = { narratorVoice: `Kokoro ${narratorVoice}`, assistantVoice: `Kokoro ${assistantVoice}`, speechSpeed: speed, loudnessTargetLUFS: -18, truePeakLimitDb: -2, tailGapMs: 800, segments, durationMs: segments.reduce((sum, row) => sum + row.durationMs, 0) };
  console.log(`Audio timeline: ${(timeline.durationMs / 1000).toFixed(3)} s; title/end cards add 5 s, plus actual UI interaction time.`);
  if (timeline.durationMs + 5000 >= 180000) throw new Error('Audio and cards alone reach 180 seconds. Shorten narration before recording.');
  writeFileSync(manifest, JSON.stringify(timeline, null, 2) + '\n');
}
try { main(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
