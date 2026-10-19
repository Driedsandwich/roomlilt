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
  const voiceList = run('say', ['-v', '?']).stdout;
  // The submitted video used "Tom (Enhanced)"; NARRATOR_MAC_VOICE overrides it.
  const narratorVoice = process.env.NARRATOR_MAC_VOICE?.trim() || 'Tom (Enhanced)';
  if (!voiceList.split('\n').some(line => line.startsWith(`${narratorVoice} `))) {
    throw new Error(`Narrator voice "${narratorVoice}" is not installed. Add it in System Settings > Accessibility > Spoken Content > System voice > Manage Voices, or set NARRATOR_MAC_VOICE.`);
  }
  let assistantVoice = 'Samantha';
  const firstAssistant = rows.find(row => row.assistant.trim())?.assistant.trim();
  if (firstAssistant) {
    assistantVoice = /^Ava \(Premium\)\s/m.test(voiceList) ? 'Ava (Premium)' : 'Samantha';
    const source = resolve(audioDir, 'assistant-preflight.aiff');
    const output = resolve(audioDir, 'assistant-preflight.wav');
    const checkVoice = () => {
      run('say', ['-v', assistantVoice, '-o', source, firstAssistant]);
      duration(source);
      normalize(source, output); // Reject nonempty-but-silent audio too.
    };
    try { checkVoice(); }
    catch (error) {
      if (assistantVoice !== 'Ava (Premium)') throw error;
      console.warn(`Ava (Premium) preflight failed: ${error instanceof Error ? error.message : String(error)}`);
      console.warn('Trying Samantha.');
      assistantVoice = 'Samantha';
      try { checkVoice(); }
      catch (fallbackError) { throw new Error(`Samantha preflight failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}. No timeline was written. Check that macOS speech synthesis can write audio files.`); }
    }
    unlinkSync(source);
    unlinkSync(output);
    console.log(`Assistant preflight passed: ${assistantVoice}.`);
  }
  const segments = rows.map(row => {
    function create(role: 'narrator' | 'assistant'): Clip | null {
      const line = row[role].trim();
      if (!line) return null;
      const source = resolve(audioDir, `${row.id}-${role}-source.aiff`);
      const output = resolve(audioDir, `${row.id}-${role}.wav`);
      if (role === 'narrator') { run('say', ['-v', narratorVoice, '-o', source, line]); duration(source); }
      else {
        try {
          run('say', ['-v', assistantVoice, '-o', source, line]);
          duration(source); // Some sandboxed say runs exit 0 but write no samples.
          normalize(source, output);
        }
        catch (error) {
          if (assistantVoice !== 'Ava (Premium)') throw error;
          console.warn('Ava (Premium) could not synthesize; falling back to Samantha.');
          assistantVoice = 'Samantha';
          run('say', ['-v', assistantVoice, '-o', source, line]);
          duration(source);
          normalize(source, output);
        }
      }
      if (role === 'narrator') normalize(source, output);
      const clip = { file: relative(root, output).split(sep).join('/'), durationMs: duration(output) };
      console.log(`${row.id} ${role}: ${clip.durationMs} ms`);
      return clip;
    }
    const narrator = create('narrator');
    const assistant = create('assistant');
    return { id: row.id, narrator, assistant, durationMs: (narrator?.durationMs ?? 0) + (assistant?.durationMs ?? 0) + 800 };
  });
  const timeline = { narratorVoice, assistantVoice, loudnessTargetLUFS: -18, truePeakLimitDb: -2, tailGapMs: 800, segments, durationMs: segments.reduce((sum, row) => sum + row.durationMs, 0) };
  console.log(`Audio timeline: ${(timeline.durationMs / 1000).toFixed(3)} s; title/end cards add 5 s, plus actual UI interaction time.`);
  if (timeline.durationMs + 5000 >= 180000) throw new Error('Audio and cards alone reach 180 seconds. Shorten narration before recording.');
  writeFileSync(manifest, JSON.stringify(timeline, null, 2) + '\n');
}
try { main(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
