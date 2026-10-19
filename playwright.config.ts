import { defineConfig } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

// Keep browser downloads, profiles, screenshots, and test state inside the project.
process.env.TMPDIR = resolve('data/browser-tmp');
mkdirSync(process.env.TMPDIR, { recursive: true });
// Each run owns fresh fictional state, including when older schema fixtures exist.
process.env.ROOMLILT_BROWSER_DATA_FILE ??= `data/tests/browser-${randomUUID()}.json`;

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:5173', viewport: { width: 1280, height: 800 }, headless: true, trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: false,
    env: { DATA_FILE: process.env.ROOMLILT_BROWSER_DATA_FILE },
    timeout: 20000,
  },
});
