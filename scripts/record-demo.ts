import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import type { Locator } from '@playwright/test';
import { createServer } from 'vite';
import { createApplication } from '../src/server/app.js';

// Run from the project root. All state, browser profiles and recordings stay here.
process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve('data/browser-cache');
process.env.TMPDIR = resolve('data/browser-tmp');
await mkdir(process.env.TMPDIR, { recursive: true });
const { chromium, expect } = await import('@playwright/test');
const narration = JSON.parse(await readFile('video/narration.json', 'utf8')) as Array<{ id: string; action: string; narrator: string; assistant: string }>;
const timeline = JSON.parse(await readFile('video/audio/timeline.json', 'utf8')) as { segments: Array<{ id: string; durationMs: number; narrator: { durationMs: number } | null; assistant: { durationMs: number } | null }> };
const expected = ['hook', 'what-it-is', 'morning', 'morning-consent', 'evening', 'decline', 'declined', 'accept', 'saved', 'persistence', 'change', 'repair-consent', 'protocol', 'close'];
if (JSON.stringify(narration.map(s => s.id)) !== JSON.stringify(expected) || JSON.stringify(timeline.segments.map(s => s.id)) !== JSON.stringify(expected)) throw new Error('Narration/timeline ids must match the storyboard. Synthesize audio again after editing narration.');
for (const clip of timeline.segments) {
  const audioMs = (clip.narrator?.durationMs ?? 0) + (clip.assistant?.durationMs ?? 0);
  if (!Number.isFinite(clip.durationMs) || clip.durationMs < audioMs || clip.durationMs <= 0) throw new Error(`Invalid duration for ${clip.id}`);
}
const plannedMs = timeline.segments.reduce((n, s) => n + s.durationMs, 0);
console.log(`Audio holds: ${(plannedMs / 1000).toFixed(2)} s; recording also includes real interaction time.`);
if (plannedMs + 5000 >= 180000) throw new Error('Audio alone leaves no room under three minutes. Shorten narration.');
if (process.argv.includes('--check')) { console.log('Recorder storyboard/timeline validation passed; Chromium was not launched.'); process.exit(0); }

await mkdir('video/raw', { recursive: true });
const dataFile = `video/raw/household-${randomUUID()}.json`;
const application = await createApplication({ dataFile });
let web: Awaited<ReturnType<typeof createServer>> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  // Never reset or reuse another person's running server. Busy ports fail.
  await application.listen(3001);
  web = await createServer({ server: { host: '127.0.0.1', port: 5173, strictPort: true } });
  await web.listen();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: 'video/raw', size: { width: 1280, height: 800 } }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const video = page.video()!;
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('http://127.0.0.1:5173');
  await expect(page.locator('#connection-label')).toHaveText('Connected locally');
  // Speech is off by default; synthesized audio is added later, never double-spoken.
  await expect(page.locator('#voice-toggle')).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Reset demo', exact: true }).click();
  const ready = async () => { await expect(page.locator('#utterance')).toBeEnabled(); };
  await ready();
  const show = async (target: Locator) => { await target.scrollIntoViewIfNeeded(); };
  const deliberateClick = async (target: Locator) => {
    await show(target); await target.hover(); await page.waitForTimeout(180); await target.click();
  };
  const utter = async (text: string) => {
    await ready();
    const chip = page.locator('.suggestions [data-utterance]').filter({ hasText: text });
    await deliberateClick(chip);
    await ready();
  };
  const recommended = page.locator('.plan-card.recommended');
  const dialog = page.getByRole('dialog');
  const showProtocolEntry = async (entry: Locator) => {
    await entry.locator('summary').click();
    await entry.evaluate(element => {
      const panel = document.querySelector<HTMLElement>('#protocol-traffic')!;
      panel.scrollTop += element.getBoundingClientRect().top - panel.getBoundingClientRect().top - 8;
    });
    await show(entry.locator('summary'));
  };
  const choose = async (member: string) => {
    await deliberateClick(recommended.locator('[data-plan]'));
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(`${member}, does this work for you?`);
  };
  const accept = async () => { await deliberateClick(dialog.locator('[data-consent="accept"]')); await ready(); };
  const snapshots: Record<string, ReturnType<typeof application.store.snapshot>> = {};
  // A 32px corner marker provides an encoded-frame time anchor without
  // replacing product content. Decode it after recording instead of guessing
  // the video start from browser launch/close wall-clock latency.
  const markerColors = narration.map((_, i) => [40 + (i % 3) * 90, 40 + (Math.floor(i / 3) % 3) * 90, i < 9 ? 70 : 210]);
  const marker = async (color: number[]) => {
    await page.evaluate(rgb => {
      let element = document.querySelector<HTMLDivElement>('#recording-sync-marker');
      if (!element) {
        element = document.createElement('div'); element.id = 'recording-sync-marker'; element.setAttribute('aria-hidden', 'true');
        element.style.cssText = 'position:fixed;left:0;top:0;width:32px;height:32px;z-index:2147483647;pointer-events:none';
      }
      // A modal's top-layer backdrop covers body content regardless of z-index.
      // Keep the marker inside the active dialog while consent is on screen.
      (document.querySelector('dialog[open]') ?? document.body).append(element);
      element.style.background = `rgb(${rgb.join(',')})`;
    }, color);
  };
  for (const segment of narration) {
    console.log(`Recording ${segment.id}: ${segment.action}`);
    switch (segment.id) {
      case 'hook': case 'what-it-is': await page.evaluate(() => window.scrollTo(0, 0)); break;
      case 'morning':
        await utter("What's clashing today?"); await expect(page.locator('.conflict-card')).toHaveCount(2);
        await utter('Find a fair plan'); await expect(recommended).toContainText('Required yield'); await show(recommended); break;
      case 'morning-consent': await choose('Sam'); break;
      case 'evening': {
        await utter('Who gets the living room tonight?');
        await expect(recommended).toContainText('Fairest');
        const lowest = page.locator('.plan-card').filter({ has: page.locator('.plan-badge', { hasText: /^Lowest disruption$/ }) });
        await expect(lowest).toHaveCount(1);
        await expect(recommended.locator('.plan-changes')).toContainText('Leo');
        await expect(lowest.locator('.plan-changes')).toContainText('Sam');
        await show(recommended);
        // Assert the two comparison headings really share the video viewport.
        const a = await recommended.locator('h3').boundingBox(); const b = await lowest.locator('h3').boundingBox();
        if (!a || !b || a.y < 0 || b.y < 0 || a.y + a.height > 800 || b.y + b.height > 800 || Math.abs(a.y - b.y) > 150) throw new Error('Comparison headings are not side by side in the viewport.');
        snapshots.beforeDecline = application.store.snapshot(); break;
      }
      case 'decline': await choose('Leo'); break;
      case 'declined':
        await expect(page.locator('#messages')).toContainText('Leo did not consent.');
        if (JSON.stringify(application.store.snapshot()) !== JSON.stringify(snapshots.beforeDecline)) throw new Error('Declining changed persisted state.');
        await show(recommended); break;
      case 'accept': await choose('Leo'); break;
      case 'saved': await expect(page.locator('.agreement-card')).toHaveCount(2); snapshots.saved = application.store.snapshot(); await show(page.locator('.agreement-list')); break;
      case 'persistence':
        await page.reload(); await expect(page.locator('#connection-label')).toHaveText('Connected locally');
        await utter('What did we agree?'); await expect(page.locator('.agreement-card')).toHaveCount(2);
        if (JSON.stringify(application.store.snapshot()) !== JSON.stringify(snapshots.saved)) throw new Error('Reconnect changed saved state.');
        await show(page.locator('.agreement-list')); break;
      case 'change':
        await utter("Leo's meeting runs 30 minutes late"); await expect(page.locator('.kept-agreements')).toContainText('2 earlier agreements kept');
        await expect(recommended.locator('.plan-changes')).toContainText('Video meeting');
        await expect(recommended.locator('.plan-changes')).not.toContainText('Laundry'); await show(page.locator('.kept-agreements')); break;
      case 'repair-consent': await choose('Leo'); break;
      case 'protocol': {
        await expect(page.locator('.agreement-card')).toHaveCount(3);
        for (const agreement of snapshots.saved.agreements) expect(application.store.snapshot().agreements.find(a => a.id === agreement.id)).toEqual(agreement);
        await deliberateClick(page.locator('#protocol-inspector > summary'));
        const entries = page.locator('.protocol-entry');
        const init = entries.filter({ hasText: /result.*initialize/ }).first();
        await showProtocolEntry(init); await expect(init).toContainText('"protocolVersion": "2025-11-25"');
        break;
      }
      case 'close': await utter('Is it fair?'); await expect(page.locator('.ledger-member')).toHaveCount(3); await show(page.locator('.ledger-list')); break;
    }
    // Start the synthesized lines only once the relevant real screen is visible.
    const durationMs = timeline.segments.find(s => s.id === segment.id)!.durationMs;
    if (segment.assistant) await expect(page.locator('body')).toContainText(segment.assistant);
    await marker(markerColors[narration.indexOf(segment)]);
    if (segment.id === 'protocol') {
      const steps = ['tools/list', 'tools/call', 'elicitation/create'];
      await page.waitForTimeout(durationMs / 4);
      for (const method of steps) {
        const entry = page.locator('.protocol-entry').filter({ has: page.locator('summary strong', { hasText: new RegExp(`^${method}$`) }) }).last();
        await expect(entry).toHaveCount(1); await showProtocolEntry(entry);
        await page.waitForTimeout(durationMs / 4);
      }
    } else await page.waitForTimeout(durationMs);
    await marker([0, 0, 0]);
    if (['morning-consent', 'accept', 'repair-consent'].includes(segment.id)) await accept();
    if (segment.id === 'decline') { await deliberateClick(dialog.getByRole('button', { name: 'Decline', exact: true })); await ready(); }
  }
  expect(pageErrors).toEqual([]);
  await page.waitForTimeout(250);
  await context.close();
  const videoFile = (await video.path()).replace(`${process.cwd()}/`, '');
  const durationMs = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', videoFile], { encoding: 'utf8' }).trim()) * 1000;
  const frameInfo = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_frames', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', videoFile], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })) as { frames: Array<{ best_effort_timestamp_time: string }> };
  const pixels = execFileSync('ffmpeg', ['-v', 'error', '-i', videoFile, '-vf', 'crop=8:8:12:12,scale=1:1', '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { maxBuffer: 16 * 1024 * 1024 });
  if (pixels.length !== frameInfo.frames.length * 3) throw new Error('Decoded frame count does not match timestamp count.');
  const frameSegments = frameInfo.frames.map((frame, i) => {
    const pixel = [...pixels.subarray(i * 3, i * 3 + 3)];
    const distances = markerColors.map(color => color.reduce((sum, v, channel) => sum + (v - pixel[channel]) ** 2, 0));
    const distance = Math.min(...distances);
    return { ms: Math.round(Number(frame.best_effort_timestamp_time) * 1000), segment: distance <= 1225 ? distances.indexOf(distance) : -1 };
  });
  const segments = narration.map((segment, index) => {
    const first = frameSegments.findIndex(frame => frame.segment === index);
    let last = frameSegments.length - 1;
    while (last >= 0 && frameSegments[last].segment !== index) last--;
    if (first < 0 || last < first) throw new Error(`Encoded timing marker missing for ${segment.id}.`);
    return { id: segment.id, startMs: frameSegments[first].ms, endMs: frameSegments[last + 1]?.ms ?? durationMs };
  });
  const timingResolutionMs = Math.max(...frameSegments.slice(1).map((frame, i) => frame.ms - frameSegments[i].ms));
  await writeFile('video/raw/segments.json', JSON.stringify({ videoFile, segments, durationMs, width: 1280, height: 800, timingMethod: 'encoded corner marker transitions with ffprobe frame timestamps', timingResolutionMs, dataFile }, null, 2) + '\n');
  console.log(`Recorded ${videoFile}, ${(durationMs / 1000).toFixed(2)} s. Segment times saved to video/raw/segments.json.`);
  if (durationMs + 5000 >= 180000) throw new Error('Raw recording plus cards exceeds three minutes; shorten narration and re-record.');
} finally {
  await browser?.close();
  await web?.close();
  await application.close();
}
