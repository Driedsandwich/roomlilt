import type { HouseholdState } from '../shared/types.js';

/** The demo deliberately uses a fixed date so resets and video rehearsals are reproducible. */
export function createDemoState(): HouseholdState {
  const date = '2026-10-19';
  return {
    schemaVersion: 2,
    revision: 0,
    date,
    fictional: true,
    members: [
      { id: 'maya', name: 'Maya', description: 'Night-shift nurse; protected recovery sleep from 08:00 to 14:00.' },
      { id: 'leo', name: 'Leo', description: 'Works from home; has a video meeting from 10:00 to 11:00.' },
      { id: 'sam', name: 'Sam', description: 'Student; shares the living room and washer/dryer.' },
    ],
    resources: [
      { id: 'washer-dryer', name: 'Washer / dryer', shared: true },
      { id: 'living-room', name: 'Living room', shared: true },
      { id: 'private-study', name: 'Private study', shared: false },
      { id: 'maya-bedroom', name: "Maya's bedroom", shared: false },
      { id: 'kitchen', name: 'Kitchen', shared: true },
    ],
    activities: [
      { id: 'maya-sleep', memberId: 'maya', title: 'Recovery sleep', date, start: 480, end: 840, resourceId: 'maya-bedroom', loud: false, needsQuiet: true, fixed: true, protectedNeed: 'Post-shift recovery' },
      { id: 'leo-meeting', memberId: 'leo', title: 'Video meeting', date, start: 600, end: 660, resourceId: 'living-room', loud: false, needsQuiet: true, fixed: false, flexibleWindow: { start: 600, end: 750 }, alternativeResourceIds: ['private-study'] },
      { id: 'sam-laundry', memberId: 'sam', title: 'Laundry', date, start: 540, end: 660, resourceId: 'washer-dryer', loud: true, needsQuiet: false, fixed: false, flexibleWindow: { start: 840, end: 1080 } },
      { id: 'sam-class', memberId: 'sam', title: 'Online class', date, start: 660, end: 720, resourceId: 'living-room', loud: false, needsQuiet: false, fixed: false, flexibleWindow: { start: 660, end: 780 } },
      { id: 'maya-breakfast', memberId: 'maya', title: 'Breakfast after the shift', date, start: 420, end: 450, resourceId: 'kitchen', loud: false, needsQuiet: false, fixed: false },
      { id: 'leo-reading', memberId: 'leo', title: 'Evening reading', date, start: 1140, end: 1200, resourceId: 'living-room', loud: false, needsQuiet: false, fixed: false, alternativeResourceIds: ['private-study'] },
      { id: 'sam-game', memberId: 'sam', title: 'Game night with friends', date, start: 1140, end: 1260, resourceId: 'living-room', loud: true, needsQuiet: false, fixed: false, flexibleWindow: { start: 1140, end: 1320 } },
    ],
    ledger: [
      { memberId: 'maya', yieldCount: 2, requiredYields: 1, negotiatedYields: 1, effortPoints: 4 },
      { memberId: 'leo', yieldCount: 1, requiredYields: 0, negotiatedYields: 1, effortPoints: 2 },
      { memberId: 'sam', yieldCount: 8, requiredYields: 6, negotiatedYields: 2, effortPoints: 18 },
    ],
    agreements: [],
  };
}
