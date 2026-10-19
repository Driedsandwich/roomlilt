import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HouseholdStore } from '../src/domain/store.js';
import { applyPlan, findConflicts, proposePlans } from '../src/domain/solver.js';

const directories: string[] = [];
async function temporaryPath() {
  const dir = await mkdtemp(join(process.cwd(), 'data-test-'));
  directories.push(dir);
  return join(dir, 'household.json');
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('atomic household persistence', () => {
  it('loads a canonical state, persists consent, and survives a fresh store instance', async () => {
    const file = await temporaryPath();
    const store = new HouseholdStore(file);
    expect(() => store.snapshot()).toThrow('Load');
    const state = await store.load();
    const plan = proposePlans(state, findConflicts(state)[0].id)[0];
    const committed = applyPlan(state, plan, ['sam']);
    await store.save(committed);
    expect(await new HouseholdStore(file).load()).toEqual(committed);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(committed);
    expect(await readdir(join(file, '..'))).toEqual(['household.json']);
    const copy = store.snapshot();
    copy.ledger[0].effortPoints = 999999;
    expect(store.snapshot().ledger[0].effortPoints).not.toBe(999999);
    expect(await store.reset()).toEqual(state);
  });

  it('serializes atomic writes and keeps a defensive snapshot of input', async () => {
    const file = await temporaryPath();
    const store = new HouseholdStore(file);
    const state = await store.load();
    const first = { ...state, revision: 1 };
    const second = { ...state, revision: 2 };
    const saveFirst = store.save(first);
    first.revision = 10;
    const saveSecond = store.save(second);
    await Promise.all([saveFirst, saveSecond]);
    expect(store.snapshot().revision).toBe(2);
    expect((await new HouseholdStore(file).load()).revision).toBe(2);
  });

  it('does not silently replace malformed existing household data', async () => {
    const file = await temporaryPath();
    const invalid = '{"schemaVersion":99}';
    await writeFile(file, invalid);
    await expect(new HouseholdStore(file).load()).rejects.toThrow('unsupported schema');
    expect(await readFile(file, 'utf8')).toBe(invalid);
  });

  it('preserves first-pass files and requires an explicit reset for the changed ledger schema', async () => {
    const file = await temporaryPath();
    const original = JSON.stringify({ schemaVersion: 1, fictional: true });
    await writeFile(file, original);
    const store = new HouseholdStore(file);
    await expect(store.load()).rejects.toThrow('npm run demo:reset');
    expect(await readFile(file, 'utf8')).toBe(original);
    expect((await store.reset()).schemaVersion).toBe(2);
  });
});
