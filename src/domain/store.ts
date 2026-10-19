import { mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { HouseholdState } from '../shared/types.js';
import { createDemoState } from './seed.js';

function validateState(value: unknown): asserts value is HouseholdState {
  const state = value as HouseholdState;
  if (!state || state.schemaVersion !== 2 || state.fictional !== true || !Number.isInteger(state.revision) || state.revision < 0 || typeof state.date !== 'string' || !Array.isArray(state.activities) || !Array.isArray(state.members) || !Array.isArray(state.resources) || !Array.isArray(state.ledger) || !Array.isArray(state.agreements)) throw new Error('Household data is invalid or uses an unsupported schema. First-pass demo files require an explicit npm run demo:reset; existing data was not changed.');
  const memberIds = new Set(state.members.map((m) => m.id));
  if (memberIds.size !== state.members.length || state.members.some((m) => typeof m.id !== 'string' || !m.id || typeof m.name !== 'string')) throw new Error('Household member data is invalid.');
  const resourceIds = new Set(state.resources.map((r) => r.id));
  if (state.activities.some((a) => typeof a.id !== 'string' || !memberIds.has(a.memberId) || !resourceIds.has(a.resourceId) || !Number.isInteger(a.start) || !Number.isInteger(a.end) || a.start < 0 || a.start >= a.end || a.end > 1440 || typeof a.loud !== 'boolean' || typeof a.needsQuiet !== 'boolean' || typeof a.fixed !== 'boolean')) throw new Error('Household activity data is invalid.');
  if (state.activities.some((a) =>
    (a.protectedNeed !== undefined && (typeof a.protectedNeed !== 'string' || !a.fixed)) ||
    (a.flexibleWindow !== undefined && (!Number.isInteger(a.flexibleWindow.start) || !Number.isInteger(a.flexibleWindow.end) || a.flexibleWindow.start < 0 || a.flexibleWindow.start >= a.flexibleWindow.end || a.flexibleWindow.end > 1440)) ||
    (a.minDuration !== undefined && (!Number.isInteger(a.minDuration) || a.minDuration < 15 || a.minDuration > a.end - a.start)) ||
    (a.quietAlternative !== undefined && (typeof a.quietAlternative.mode !== 'string' || typeof a.quietAlternative.loud !== 'boolean')) ||
    (a.alternativeResourceIds !== undefined && (!Array.isArray(a.alternativeResourceIds) || a.alternativeResourceIds.some((id) => !resourceIds.has(id))))
  )) throw new Error('Household activity alternatives are invalid.');
  if (new Set(state.activities.map((a) => a.id)).size !== state.activities.length || state.ledger.length !== memberIds.size || new Set(state.ledger.map((e) => e.memberId)).size !== memberIds.size || state.ledger.some((e) => !memberIds.has(e.memberId) || [e.yieldCount, e.requiredYields, e.negotiatedYields].some((n) => !Number.isInteger(n) || n < 0) || e.yieldCount !== e.requiredYields + e.negotiatedYields || !Number.isFinite(e.effortPoints) || e.effortPoints < 0)) throw new Error('Household ledger data is invalid.');
}

/** The in-memory snapshot changes only after an atomic file replacement succeeds. */
export class HouseholdStore {
  private state: HouseholdState | undefined;
  private pending: Promise<void> = Promise.resolve();

  constructor(readonly filePath: string) {}

  async load(): Promise<HouseholdState> {
    await this.pending;
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, 'utf8'));
      validateState(parsed);
      this.state = structuredClone(parsed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await this.save(createDemoState());
    }
    return this.snapshot();
  }

  snapshot(): HouseholdState {
    if (!this.state) throw new Error('Load the household store before reading it.');
    return structuredClone(this.state);
  }

  async save(state: HouseholdState): Promise<void> {
    validateState(state);
    const snapshot = structuredClone(state);
    const operation = this.pending.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        await rename(temporaryPath, this.filePath);
        this.state = snapshot;
      } catch (error) {
        await unlink(temporaryPath).catch(() => undefined);
        throw error;
      }
    });
    this.pending = operation.catch(() => undefined);
    await operation;
  }

  async reset(): Promise<HouseholdState> {
    await this.save(createDemoState());
    return this.snapshot();
  }
}
