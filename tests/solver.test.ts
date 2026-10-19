import { describe, expect, it } from 'vitest';
import { createDemoState } from '../src/domain/seed.js';
import { applyPlan, findConflicts, proposePlans, reportChange, scoreChanges } from '../src/domain/solver.js';
import type { Activity, HouseholdState, Plan } from '../src/shared/types.js';

const firstPlans = (state = createDemoState()) => proposePlans(state, findConflicts(state)[0].id);
const eveningPlans = (state: HouseholdState) => proposePlans(state, findConflicts(state).find((c) => c.start >= 18 * 60)!.id);
const accept = (state: HouseholdState, plan: Plan) => applyPlan(state, plan, plan.yieldingMemberIds);
const morningAgreed = () => { const state = createDemoState(); return accept(state, firstPlans(state)[0]); };
const dayAgreed = () => { const state = morningAgreed(); return accept(state, eveningPlans(state)[0]); };

describe('household planning', () => {
  it('separates required morning protection from a negotiable evening clash', () => {
    const state = createDemoState();
    expect(state.activities).toHaveLength(7);
    const conflicts = findConflicts(state);
    expect(conflicts).toHaveLength(2);
    expect(conflicts[0].activityIds).toEqual(['leo-meeting', 'maya-sleep', 'sam-laundry']);
    expect(conflicts[1].activityIds).toEqual(['leo-reading', 'sam-game']);
    expect(findConflicts(state, '2026-10-20')).toEqual([]);
    expect(conflicts[0].description).toContain('noise conflicts');
  });

  it('records the unavoidable morning adjustment as a bounded required yield', () => {
    const state = createDemoState();
    const plans = firstPlans(state);
    expect(plans.length).toBeGreaterThanOrEqual(2);
    expect(plans.length).toBeLessThanOrEqual(3);
    expect(new Set(plans.map((p) => p.title)).size).toBe(plans.length);
    expect(plans[0].yieldingMemberIds).toEqual(['sam']);
    expect(plans[0].changes).toHaveLength(1);
    expect(plans[0].changes[0]).toMatchObject({ activityId: 'sam-laundry', yieldType: 'required', effortPoints: 2, after: { start: 840, end: 960 } });
    expect(plans[0].ledgerImpact).toEqual([{ memberId: 'sam', yieldCount: 1, requiredYields: 1, negotiatedYields: 0, effortPoints: 2 }]);
    expect(plans[0].badges).toContain('Required yield');
    for (const plan of plans) {
      const next = accept(state, plan);
      expect(findConflicts(next).map((c) => c.activityIds)).toEqual([['leo-reading', 'sam-game']]);
      expect(next.activities.find((a) => a.fixed)).toEqual(state.activities.find((a) => a.fixed));
      expect(plan.changes.every((c) => !c.before.fixed && c.effortPoints >= 1 && c.effortPoints <= 3)).toBe(true);
    }
    expect(firstPlans(state)).toEqual(plans);
    expect(state.revision).toBe(0);
    expect(morningAgreed().ledger.find((e) => e.memberId === 'sam')).toMatchObject({ yieldCount: 9, requiredYields: 7, negotiatedYields: 2, effortPoints: 20 });
  });

  it('visibly recommends a different evening yielder from the lowest-disruption plan', () => {
    const state = morningAgreed();
    const plans = eveningPlans(state);
    const fair = plans.find((p) => p.badges.includes('Fairest'))!;
    const least = plans.find((p) => p.badges.includes('Lowest disruption'))!;
    expect(fair).toBe(plans[0]);
    expect(fair.recommended).toBe(true);
    expect(fair.yieldingMemberIds).toEqual(['leo']);
    expect(fair.changes[0].after.resourceId).toBe('private-study');
    expect(fair.disruptionScore).toBe(2);
    expect(least.yieldingMemberIds).toEqual(['sam']);
    expect(least.changes[0].after).toMatchObject({ start: 1200, end: 1320, resourceId: 'living-room' });
    expect(least.disruptionScore).toBe(1.5);
    expect(least.disruptionScore).toBeLessThan(fair.disruptionScore);
    expect(fair.score).toBeLessThan(least.score);
    expect(fair.reason).toContain('Sam has yielded 9 times in 14 days; Leo once');
    expect(fair.reason).toContain('Leo is asked first');
    expect(fair.ledgerImpact[0]).toMatchObject({ requiredYields: 0, negotiatedYields: 1 });
    for (const plan of plans) expect(findConflicts(accept(state, plan))).toEqual([]);
    const agreed = accept(state, fair);
    expect(agreed.activities.find((a) => a.id === 'sam-game')).toEqual(state.activities.find((a) => a.id === 'sam-game'));
    expect(agreed.ledger.find((e) => e.memberId === 'leo')).toMatchObject({ yieldCount: 2, negotiatedYields: 2, effortPoints: 4 });
  });

  it('changes the recommendation when only ledger history changes, counting required yields too', () => {
    const state = morningAgreed();
    const plans = eveningPlans(state);
    const reversed = structuredClone(state);
    reversed.ledger = reversed.ledger.map((e) => ({ ...e, yieldCount: e.memberId === 'leo' ? 20 : 0, requiredYields: e.memberId === 'leo' ? 20 : 0, negotiatedYields: 0 }));
    expect(eveningPlans(reversed)[0].yieldingMemberIds).toEqual(['sam']);
    expect(scoreChanges(state, plans[0].changes)).toBeLessThan(scoreChanges(state, plans[1].changes));
    const zero = { ...state, ledger: state.ledger.map((e) => ({ ...e, yieldCount: 0, requiredYields: 0, negotiatedYields: 0 })) };
    expect(eveningPlans(zero)[0].yieldingMemberIds).toEqual(['sam']);
  });

  it('uses arbitrary identities, room IDs, activity titles, and only declared alternatives', () => {
    const original = morningAgreed();
    const state = structuredClone(original);
    const rename = (value: string) => `other-${value}`;
    state.members = state.members.map((m, i) => ({ ...m, id: rename(m.id), name: ['Ari', 'Bo', 'Casey'][i] }));
    state.resources = state.resources.map((r, i) => ({ ...r, id: rename(r.id), name: `Room ${i + 1}` }));
    state.ledger = state.ledger.map((e) => ({ ...e, memberId: rename(e.memberId) }));
    state.activities = state.activities.map((a, i) => ({ ...a, id: rename(a.id), memberId: rename(a.memberId), title: `Session ${i + 1}`, resourceId: rename(a.resourceId), alternativeResourceIds: a.alternativeResourceIds?.map(rename) }));
    const preferred = eveningPlans(state)[0];
    expect(preferred.yieldingMemberIds).toEqual(['other-leo']);
    expect(preferred.changes[0].after.resourceId).toBe('other-private-study');
    expect(preferred.title).toContain('Bo: Session');
    expect(preferred.reason).toContain('Casey has yielded 9');
    expect(preferred.reason).not.toMatch(/Sam|Leo|guitar/);
    for (const a of state.activities) delete a.alternativeResourceIds;
    const withoutRooms = eveningPlans(state);
    expect(withoutRooms.every((p) => p.changes.every((c) => c.after.resourceId === c.before.resourceId))).toBe(true);
    expect(withoutRooms[0].yieldingMemberIds).toEqual(['other-sam']);
  });

  it('offers a quiet mode only when the activity explicitly declares it', () => {
    const state = createDemoState();
    const protectedActivity = state.activities.find((a) => a.fixed)!;
    const noisy: Activity = { id: 'unknown-activity', memberId: 'sam', title: 'Unfamiliar session', date: state.date, start: 600, end: 630, resourceId: 'living-room', loud: true, needsQuiet: false, fixed: false };
    state.activities = [protectedActivity, noisy];
    expect(firstPlans(state)).toEqual([]);
    noisy.quietAlternative = { mode: 'Silent equipment', loud: false };
    const plan = firstPlans(state)[0];
    expect(plan.changes[0].after).toMatchObject({ loud: false, mode: 'Silent equipment', start: 600, end: 630 });
    expect(findConflicts(accept(state, plan))).toEqual([]);
  });

  it('distinguishes room-change titles when their timing or duration also differs', () => {
    const state = createDemoState();
    const template = state.activities.find((a) => a.id === 'sam-class')!;
    state.activities = [
      { ...template, id: 'flexible-session', title: 'Flexible session', start: 540, end: 660, alternativeResourceIds: ['private-study'], flexibleWindow: { start: 525, end: 780 }, minDuration: 105 },
      { ...template, id: 'room-booking', memberId: 'leo', start: 540, end: 780, fixed: true },
      { ...template, id: 'appointment', start: 645, end: 660, resourceId: 'kitchen', fixed: true },
    ];
    const plans = firstPlans(state);
    expect(plans).toHaveLength(2);
    expect(new Set(plans.map((p) => p.title)).size).toBe(plans.length);
    expect(plans.every((p) => p.title.includes('Private study at '))).toBe(true);
    expect(plans.some((p) => p.title.includes('08:45–10:45'))).toBe(true);
    expect(plans.some((p) => p.title.includes('09:00–10:45'))).toBe(true);
  });

  it('shortens only with declared permission and makes the lost time explicit for consent', () => {
    const state = createDemoState();
    const template = state.activities.find((a) => a.id === 'sam-class')!;
    state.activities = [
      { ...template, id: 'flexible-session', memberId: 'sam', title: 'Drawing session', start: 540, end: 615, minDuration: 60, flexibleWindow: { start: 540, end: 780 } },
      { ...template, id: 'fixed-session', memberId: 'leo', title: 'Booked room', start: 600, end: 660, fixed: true },
    ];
    const shorter = firstPlans(state).find((p) => p.changes.some((c) => c.after.end - c.after.start < c.before.end - c.before.start))!;
    expect(shorter).toBeDefined();
    expect(shorter.changes[0].after).toMatchObject({ start: 540, end: 600 });
    expect(shorter.changes[0].description).toContain('shorten from 75 to 60 minutes');
    expect(shorter.changes[0].effortPoints).toBe(1.5);
    expect(shorter.changes[0].yieldType).toBe('negotiated');
    expect(() => applyPlan(state, shorter, [])).toThrow('consent');
    expect(findConflicts(accept(state, shorter))).toEqual([]);
  });

  it('retains a feasible start-time swap within both declared windows', () => {
    const state = createDemoState();
    const template = state.activities.find((a) => a.id === 'sam-class')!;
    state.activities = [
      { ...template, id: 'long-session', memberId: 'leo', title: 'Long session', start: 540, end: 660, flexibleWindow: { start: 540, end: 720 } },
      { ...template, id: 'short-session', memberId: 'sam', title: 'Short session', start: 600, end: 660, flexibleWindow: { start: 540, end: 720 } },
    ];
    const swapped = firstPlans(state).find((p) => p.changes.find((c) => c.activityId === 'long-session')?.after.start === 600 && p.changes.find((c) => c.activityId === 'short-session')?.after.start === 540)!;
    expect(swapped).toBeDefined();
    expect(swapped.changes.map((c) => c.after.end - c.after.start)).toEqual([120, 60]);
    expect(() => applyPlan(state, swapped, ['leo'])).toThrow('consent');
    expect(findConflicts(accept(state, swapped))).toEqual([]);
  });

  it('requires all yielding members and rejects forged or stale plans', () => {
    const state = createDemoState();
    const plan = firstPlans(state)[0];
    expect(() => applyPlan(state, plan, [])).toThrow('consent');
    expect(() => applyPlan(state, { ...plan, score: 0 }, ['sam'])).toThrow('valid proposal');
    const forged = structuredClone(plan);
    forged.changes[0].after.start = 1;
    expect(() => applyPlan(state, forged, ['sam'])).toThrow('valid proposal');
    const next = accept(state, plan);
    expect(next.revision).toBe(1);
    expect(() => applyPlan(next, plan, ['sam'])).toThrow('stale');
    expect(state.agreements).toEqual([]);
  });

  it('repairs the late meeting while preserving the morning and evening agreements exactly', () => {
    const state = dayAgreed();
    const earlier = structuredClone(state.agreements);
    const update = reportChange(state, 'leo-meeting', 'extend', 30);
    expect(update.affectedAgreementIds).toEqual([]);
    expect(update.keptAgreementIds).toEqual(earlier.map((a) => a.id));
    expect(update.conflicts).toHaveLength(1);
    expect(update.plans.length).toBeGreaterThanOrEqual(2);
    expect(update.plans[0].yieldingMemberIds).toEqual(['leo']);
    expect(update.plans[0].changes[0].after).toMatchObject({ id: 'leo-meeting', start: 600, end: 690, resourceId: 'private-study' });
    expect(update.plans.some((p) => p.yieldingMemberIds.includes('sam'))).toBe(true);
    const repaired = accept(update.state, update.plans[0]);
    expect(findConflicts(repaired)).toEqual([]);
    for (const agreement of earlier) {
      expect(update.state.agreements.find((a) => a.id === agreement.id)).toEqual(agreement);
      expect(repaired.agreements.find((a) => a.id === agreement.id)).toEqual(agreement);
      for (const change of agreement.changes) expect(repaired.activities.find((a) => a.id === change.activityId)).toEqual(change.after);
    }
  });

  it('supersedes only the previously agreed activity that actually changes in a subsequent repair', () => {
    const state = dayAgreed();
    const update = reportChange(state, 'leo-meeting', 'extend', 30);
    const classPlan = update.plans.find((p) => p.yieldingMemberIds.includes('sam'))!;
    const agreed = accept(update.state, classPlan);
    const classAgreement = agreed.agreements.find((a) => a.changes[0].activityId === 'sam-class')!;
    const again = reportChange(agreed, 'leo-meeting', 'extend', 15);
    expect(again.affectedAgreementIds).toEqual([classAgreement.id]);
    const delayed = again.plans.find((p) => p.yieldingMemberIds.includes('sam'))!;
    const repaired = accept(again.state, delayed);
    expect(repaired.agreements.find((a) => a.id === classAgreement.id)?.status).toBe('superseded');
    for (const previous of state.agreements) expect(repaired.agreements.find((a) => a.id === previous.id)).toEqual(previous);
    expect(findConflicts(repaired)).toEqual([]);
  });

  it('validates changes and cancels an activity without removing historical yields', () => {
    const state = dayAgreed();
    expect(() => reportChange(state, 'maya-sleep', 'cancel')).toThrow('fixed');
    expect(() => reportChange(state, 'leo-meeting', 'extend', 7)).toThrow('15-minute');
    const update = reportChange(state, 'leo-reading', 'cancel');
    expect(update.state.activities.some((a) => a.id === 'leo-reading')).toBe(false);
    expect(update.conflicts).toEqual([]);
    expect(update.plans).toEqual([]);
    expect(update.state.ledger).toEqual(state.ledger);
    expect(update.state.agreements.find((a) => a.changes[0].activityId === 'sam-laundry')).toEqual(state.agreements.find((a) => a.changes[0].activityId === 'sam-laundry'));
  });

  it('supersedes the directly extended agreement even if it creates no conflict', () => {
    const state = dayAgreed();
    const laundry = state.agreements.find((a) => a.changes[0].activityId === 'sam-laundry')!;
    const update = reportChange(state, 'sam-laundry', 'extend', 15);
    expect(update.state.activities.find((a) => a.id === 'sam-laundry')?.end).toBe(975);
    expect(update.affectedAgreementIds).toEqual([laundry.id]);
    expect(update.state.agreements.find((a) => a.id === laundry.id)).toEqual({ ...laundry, status: 'superseded' });
    expect(update.state.ledger).toEqual(state.ledger);
    expect(update.conflicts).toEqual([]);
    expect(update.plans).toEqual([]);
    expect(state.agreements.find((a) => a.id === laundry.id)?.status).toBe('active');
  });

  it('supersedes a repaired meeting agreement on another factual extension', () => {
    const state = dayAgreed();
    const first = reportChange(state, 'leo-meeting', 'extend', 30);
    const repaired = accept(first.state, first.plans[0]);
    const meeting = repaired.agreements.find((a) => a.changes[0].activityId === 'leo-meeting')!;
    const update = reportChange(repaired, 'leo-meeting', 'extend', 15);
    expect(update.affectedAgreementIds).toEqual([meeting.id]);
    expect(update.state.agreements.find((a) => a.id === meeting.id)?.status).toBe('superseded');
    expect(update.state.agreements.filter((a) => a.id !== meeting.id)).toEqual(repaired.agreements.filter((a) => a.id !== meeting.id));
    expect(update.state.ledger).toEqual(repaired.ledger);
    expect(update.conflicts).toEqual([]);
  });
});
