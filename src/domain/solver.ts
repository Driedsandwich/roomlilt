import type { Activity, Conflict, HouseholdState, LedgerEntry, MemberId, Plan, PlanChange } from '../shared/types.js';

const DAY_END = 24 * 60;
const round = (value: number) => Math.round(value * 100) / 100;
const clone = <T>(value: T): T => structuredClone(value);
const time = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const overlaps = (a: Activity, b: Activity) => a.date === b.date && a.start < b.end && b.start < a.end;

function hash(value: string): string {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  return (result >>> 0).toString(36);
}

function collisionReason(a: Activity, b: Activity): string | undefined {
  if (!overlaps(a, b)) return;
  if (a.memberId === b.memberId) return 'One member cannot do two activities at once';
  if (a.resourceId === b.resourceId) return 'Both activities need the same room or appliance';
  if ((a.loud && b.needsQuiet) || (b.loud && a.needsQuiet)) return 'Noise conflicts with protected quiet time';
}

/** Connected conflicts are solved together, including quiet time spanning several activities. */
export function findConflicts(state: HouseholdState, date = state.date): Conflict[] {
  const activities = state.activities.filter((a) => a.date === date);
  const edges: { a: Activity; b: Activity; reason: string }[] = [];
  for (let i = 0; i < activities.length; i++) {
    for (let j = i + 1; j < activities.length; j++) {
      const reason = collisionReason(activities[i], activities[j]);
      if (reason) edges.push({ a: activities[i], b: activities[j], reason });
    }
  }
  const pending = [...edges];
  const conflicts: Conflict[] = [];
  while (pending.length) {
    const first = pending.shift()!;
    const ids = new Set([first.a.id, first.b.id]);
    const group = [first];
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (let i = pending.length - 1; i >= 0; i--) {
        const edge = pending[i];
        if (ids.has(edge.a.id) || ids.has(edge.b.id)) {
          ids.add(edge.a.id); ids.add(edge.b.id);
          group.push(...pending.splice(i, 1));
          expanded = true;
        }
      }
    }
    const activityIds = [...ids].sort();
    const involved = activities.filter((a) => ids.has(a.id));
    conflicts.push({
      id: `conflict-${hash(`${date}:${activityIds.join('|')}`)}`,
      date, activityIds,
      title: involved.some((a) => a.fixed && a.needsQuiet) ? 'Quiet time needs protection' : 'Shared time needs a new agreement',
      description: [...new Set(group.map((edge) => `${edge.a.title} and ${edge.b.title}: ${edge.reason.toLowerCase()}.`))].join(' '),
      start: Math.min(...group.map(({ a, b }) => Math.max(a.start, b.start))),
      end: Math.max(...group.map(({ a, b }) => Math.min(a.end, b.end))),
    });
  }
  return conflicts.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
}

function activityOptions(activity: Activity, state: HouseholdState, involved: Activity[]): Activity[] {
  if (activity.fixed) return [activity];
  const duration = activity.end - activity.start;
  const timingOptions: Activity[] = [activity];
  // A flexible flag alone is not permission to invent another time, room, or mode.
  if (activity.flexibleWindow) {
    for (let start = activity.flexibleWindow.start; start + duration <= activity.flexibleWindow.end; start += 15) {
      timingOptions.push({ ...activity, start, end: start + duration });
    }
  }
  if (activity.minDuration !== undefined) {
    for (const other of involved.filter((item) => item.id !== activity.id && collisionReason(activity, item))) {
      for (const [start, end] of [[activity.start, other.start], [other.end, activity.end]]) {
        if (start >= activity.start && end <= activity.end && end - start >= activity.minDuration && end - start < duration) timingOptions.push({ ...activity, start, end });
      }
    }
  }
  const options: Activity[] = [];
  const resources = [activity.resourceId, ...(activity.alternativeResourceIds ?? []).filter((id) => state.resources.some((r) => r.id === id))];
  for (const timing of timingOptions) {
    for (const resourceId of resources) {
      const candidate = { ...timing, resourceId };
      options.push(candidate);
      if (activity.quietAlternative) options.push({ ...candidate, ...activity.quietAlternative });
    }
  }
  return [...new Map(options.map((option) => [JSON.stringify(option), option])).values()];
}

const shortensActivity = (plan: Plan) => plan.changes.some((c) => c.after.end - c.after.start < c.before.end - c.before.start);
const swapsActivities = (changes: PlanChange[]) => changes.some((a, index) => changes.slice(index + 1).some((b) =>
  a.before.start !== b.before.start && a.after.start === b.before.start && b.after.start === a.before.start &&
  a.after.end - a.after.start === a.before.end - a.before.start && b.after.end - b.after.start === b.before.end - b.before.start,
));

function changeFor(before: Activity, after: Activity, state: HouseholdState): PlanChange {
  const shift = Math.abs(after.start - before.start);
  const shortened = Math.max(0, (before.end - before.start) - (after.end - after.start));
  const modeChanged = after.resourceId !== before.resourceId || after.loud !== before.loud || after.mode !== before.mode;
  const effortPoints = round(Math.min(3, 1 + Math.min(1, shift / 120) + Math.min(1, shortened / 30) + (modeChanged ? 1 : 0)));
  const yieldType = state.activities.some((other) => other.fixed && other.protectedNeed && collisionReason(before, other)) ? 'required' : 'negotiated';
  const actions: string[] = [];
  if (after.end - after.start < before.end - before.start) actions.push(`shorten from ${before.end - before.start} to ${after.end - after.start} minutes`);
  if (before.start !== after.start || before.end !== after.end) actions.push(`move ${time(before.start)}–${time(before.end)} to ${time(after.start)}–${time(after.end)}`);
  if (after.resourceId !== before.resourceId) actions.push(`use ${state.resources.find((r) => r.id === after.resourceId)?.name ?? after.resourceId}`);
  if (after.loud !== before.loud || after.mode !== before.mode) actions.push(after.mode ?? 'change the activity mode');
  return { activityId: before.id, memberId: before.memberId, before: clone(before), after: clone(after), effortPoints, yieldType, description: `${before.title}: ${actions.join('; ')}.` };
}

function ledgerImpact(changes: PlanChange[]): LedgerEntry[] {
  return [...new Set(changes.map((c) => c.memberId))].sort().map((memberId) => {
    const memberChanges = changes.filter((c) => c.memberId === memberId);
    const required = memberChanges.some((c) => c.yieldType === 'required');
    return { memberId, yieldCount: 1, requiredYields: required ? 1 : 0, negotiatedYields: required ? 0 : 1, effortPoints: round(memberChanges.reduce((sum, c) => sum + c.effortPoints, 0)) };
  });
}

/** Required yields count equally: two score points per past yield, once per changing member. */
export function scoreChanges(state: HouseholdState, changes: PlanChange[]): number {
  const effort = changes.reduce((sum, change) => sum + change.effortPoints, 0);
  const history = [...new Set(changes.map((c) => c.memberId))].reduce((sum, memberId) => sum + (state.ledger.find((entry) => entry.memberId === memberId)?.yieldCount ?? 0), 0);
  return round(effort + 2 * history);
}

function planTitle(state: HouseholdState, changes: PlanChange[]): string {
  return changes.map((change) => {
    const member = state.members.find((m) => m.id === change.memberId)?.name ?? change.memberId;
    const resource = state.resources.find((r) => r.id === change.after.resourceId)?.name ?? change.after.resourceId;
    const destination = `${change.before.resourceId !== change.after.resourceId ? `in ${resource} ` : ''}at ${time(change.after.start)}–${time(change.after.end)}`;
    const mode = change.before.mode !== change.after.mode && change.after.mode ? ` (${change.after.mode})` : '';
    return `${member}: ${change.after.title} ${destination}${mode}`;
  }).join('; ');
}

function planReason(state: HouseholdState, plan: Plan, alternatives: Plan[]): string {
  const memberName = (id: MemberId) => state.members.find((m) => m.id === id)?.name ?? id;
  const history = (id: MemberId) => state.ledger.find((entry) => entry.memberId === id)?.yieldCount ?? 0;
  const required = plan.changes.filter((c) => c.yieldType === 'required');
  if (required.length) {
    const needs = [...new Set(required.flatMap((c) => state.activities.filter((a) => a.fixed && a.protectedNeed && collisionReason(c.before, a)).map((a) => `${memberName(a.memberId)}'s ${a.title}`)))];
    return `${required.map((c) => `${memberName(c.memberId)}'s ${c.before.title}`).join(' and ')} must change to protect ${needs.join(' and ')}. Required yields still count toward fairness.`;
  }
  const possibleYielders = [...new Set(alternatives.flatMap((p) => p.yieldingMemberIds))].sort((a, b) => history(b) - history(a) || a.localeCompare(b));
  if (possibleYielders.length > 1) {
    const highest = possibleYielders[0];
    const lowest = possibleYielders[possibleYielders.length - 1];
    const comparison = `${memberName(highest)} has yielded ${history(highest)} times in 14 days; ${memberName(lowest)} ${history(lowest) === 1 ? 'once' : `${history(lowest)} times`}`;
    const yielders = plan.yieldingMemberIds.map(memberName).join(' and ');
    return `${comparison}. ${plan.recommended ? `${yielders} is asked first this time` : `${yielders} makes this adjustment`}${plan.badges.includes('Lowest disruption') ? ` for the lowest disruption (${plan.disruptionScore} effort points)` : ` (${plan.disruptionScore} effort points)`}.`;
  }
  return `${plan.yieldingMemberIds.map(memberName).join(' and ')} adjusts ${plan.changes.map((c) => c.before.title).join(' and ')} for ${plan.disruptionScore} effort points. Other agreements stay unchanged.`;
}

/** Generates a small, deterministic set of feasible alternatives for one connected conflict. */
export function proposePlans(state: HouseholdState, conflictId: string): Plan[] {
  const conflict = findConflicts(state).find((candidate) => candidate.id === conflictId);
  if (!conflict) throw new Error('Conflict not found. Refresh the household state and find conflicts again.');
  const involved = state.activities.filter((a) => conflict.activityIds.includes(a.id));
  const optionSets = involved.map((a) => activityOptions(a, state, involved));
  const results: Plan[] = [];
  const baselineOtherIds = new Set(findConflicts(state).filter((c) => c.id !== conflictId).flatMap((c) => c.activityIds));
  const explore = (index: number, selected: Activity[]) => {
    if (index < involved.length) {
      for (const option of optionSets[index]) explore(index + 1, [...selected, option]);
      return;
    }
    const replacements = new Map(selected.map((a) => [a.id, a]));
    const activities = state.activities.map((a) => replacements.get(a.id) ?? a);
    const remaining = findConflicts({ ...state, activities });
    // Existing independent conflicts may remain, but this plan cannot introduce any new conflict.
    if (remaining.some((c) => c.activityIds.some((id) => !baselineOtherIds.has(id)))) return;
    const changes = involved.filter((a, i) => JSON.stringify(a) !== JSON.stringify(selected[i])).map((a) => changeFor(a, replacements.get(a.id)!, state));
    if (!changes.length) return;
    changes.sort((a, b) => a.activityId.localeCompare(b.activityId));
    const yieldingMemberIds = [...new Set(changes.map((c) => c.memberId))].sort();
    const impact = ledgerImpact(changes);
    const affectedAgreementIds = state.agreements.filter((agreement) => agreement.status === 'active' && agreement.changes.some((c) => changes.some((change) => change.activityId === c.activityId))).map((a) => a.id);
    const changeKey = JSON.stringify(changes);
    results.push({
      id: `plan-r${state.revision}-${hash(`${conflictId}:${changeKey}`)}`, revision: state.revision, conflictId,
      title: planTitle(state, changes), reason: '',
      changes, yieldingMemberIds, ledgerImpact: impact, score: scoreChanges(state, changes), affectedAgreementIds,
      disruptionScore: round(changes.reduce((sum, c) => sum + c.effortPoints, 0)), recommended: false, badges: [],
    });
  };
  explore(0, []);
  // Do not ask another member to yield when an otherwise identical feasible plan leaves them alone.
  const meaningful = results.filter((candidate) => !results.some((other) =>
    other.changes.length < candidate.changes.length && other.score <= candidate.score &&
    other.changes.every((change) => candidate.changes.some((c) => c.activityId === change.activityId && JSON.stringify(c.after) === JSON.stringify(change.after))),
  ));
  const timingChange = (plan: Plan) => plan.changes.reduce((sum, c) => sum + Math.abs(c.after.start - c.before.start) + Math.abs((c.after.end - c.after.start) - (c.before.end - c.before.start)), 0);
  // Bounded effort can tie long shifts; prefer the smaller actual timing adjustment.
  const compare = (a: Plan, b: Plan) => a.score - b.score || a.changes.length - b.changes.length || timingChange(a) - timingChange(b) || a.id.localeCompare(b.id);
  const ranked = meaningful.sort(compare);
  const selected = new Map<string, Plan>();
  if (ranked[0]) selected.set(ranked[0].id, ranked[0]);
  const lowestDisruption = [...ranked].sort((a, b) => a.disruptionScore - b.disruptionScore || compare(a, b))[0];
  if (lowestDisruption) selected.set(lowestDisruption.id, lowestDisruption);
  // Preserve the actual trade-off, plus one distinct shortening or swap when feasible.
  for (const alternative of [ranked.find(shortensActivity), ranked.find((p) => swapsActivities(p.changes))]) {
    if (alternative && selected.size < 3) selected.set(alternative.id, alternative);
  }
  for (const plan of ranked) {
    if (selected.size >= 2) break;
    if (![...selected.values()].some((p) => p.title === plan.title)) selected.set(plan.id, plan);
  }
  return [...selected.values()].sort(compare).map((plan) => {
    plan.recommended = plan.id === ranked[0].id;
    if (plan.changes.every((c) => c.yieldType === 'required')) plan.badges.push('Required yield');
    else if (plan.recommended) plan.badges.push('Fairest');
    if (plan.id === lowestDisruption.id) plan.badges.push('Lowest disruption');
    plan.reason = planReason(state, plan, ranked);
    return plan;
  });
}

/** Consent and plan validity are checked again against the current revision before any mutation. */
export function applyPlan(state: HouseholdState, plan: Plan, acceptedBy: MemberId[]): HouseholdState {
  if (plan.revision !== state.revision) throw new Error('This plan is stale. Ask for a fresh plan before agreeing.');
  const canonical = proposePlans(state, plan.conflictId).find((candidate) => candidate.id === plan.id);
  if (!canonical || JSON.stringify(canonical) !== JSON.stringify(plan)) throw new Error('This plan is not a current, valid proposal.');
  if (canonical.yieldingMemberIds.some((memberId) => !acceptedBy.includes(memberId))) throw new Error('Every yielding member must consent before the plan is committed.');
  const next = clone(state);
  next.revision++;
  next.activities = next.activities.map((activity) => clone(canonical.changes.find((c) => c.activityId === activity.id)?.after ?? activity));
  next.ledger = next.ledger.map((entry) => {
    const impact = canonical.ledgerImpact.find((e) => e.memberId === entry.memberId);
    return impact ? { ...entry, yieldCount: entry.yieldCount + impact.yieldCount, requiredYields: entry.requiredYields + impact.requiredYields, negotiatedYields: entry.negotiatedYields + impact.negotiatedYields, effortPoints: round(entry.effortPoints + impact.effortPoints) } : entry;
  });
  for (const agreement of next.agreements) if (canonical.affectedAgreementIds.includes(agreement.id)) agreement.status = 'superseded';
  // Separate activity agreements allow a later change to preserve unrelated agreements exactly.
  for (const change of canonical.changes) next.agreements.push({
    id: `agreement-r${next.revision}-${change.activityId}`, planId: canonical.id, title: canonical.title,
    changes: [clone(change)], acceptedBy: [...new Set(acceptedBy)].sort(), createdAt: new Date().toISOString(), status: 'active',
  });
  return next;
}

export function reportChange(state: HouseholdState, activityId: string, change: 'extend' | 'cancel', minutes = 30): { state: HouseholdState; affectedAgreementIds: string[]; keptAgreementIds: string[]; plans: Plan[]; conflicts: Conflict[] } {
  const activity = state.activities.find((a) => a.id === activityId);
  if (!activity) throw new Error('Activity not found.');
  if (activity.fixed) throw new Error('Protected fixed activities cannot be changed.');
  if (change !== 'extend' && change !== 'cancel') throw new Error('Change must be extend or cancel.');
  if (change === 'extend' && (!Number.isInteger(minutes) || minutes <= 0 || minutes % 15 !== 0 || activity.end + minutes > DAY_END)) throw new Error('Extension must use positive 15-minute increments within the day.');
  const next = clone(state);
  next.revision++;
  next.activities = change === 'cancel' ? next.activities.filter((a) => a.id !== activityId) : next.activities.map((a) => a.id === activityId ? { ...a, end: a.end + minutes } : a);
  const conflicts = findConflicts(next);
  const affectedActivityIds = new Set([activityId, ...conflicts.filter((c) => c.activityIds.includes(activityId)).flatMap((c) => c.activityIds)]);
  const affectedAgreementIds = next.agreements.filter((agreement) => agreement.status === 'active' && agreement.changes.some((c) => affectedActivityIds.has(c.activityId))).map((a) => a.id);
  // A reported extension or cancellation invalidates the recorded timing of that activity.
  for (const agreement of next.agreements) if (agreement.changes.some((c) => c.activityId === activityId) && agreement.status === 'active') agreement.status = 'superseded';
  const affectedConflicts = conflicts.filter((c) => c.activityIds.includes(activityId));
  const plans = affectedConflicts.flatMap((conflict) => proposePlans(next, conflict.id));
  const keptAgreementIds = next.agreements.filter((a) => a.status === 'active' && !affectedAgreementIds.includes(a.id)).map((a) => a.id);
  return { state: next, affectedAgreementIds, keptAgreementIds, plans, conflicts };
}
