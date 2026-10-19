import { describe, expect, it } from 'vitest';
import { routeIntent } from '../src/client/intent-router.js';

describe('deterministic demo intent router', () => {
  it.each(["Alexa, what's clashing today?", "Hey Alexa, what's clashing today?", 'Show today’s conflicts', 'Where do we overlap?'])('finds conflicts: %s', (text) => {
    expect(routeIntent(text)).toEqual({ kind: 'conflicts' });
  });
  it.each(['Find a fair plan', 'Hey Alexa find a fair plan', 'Alexa, can you resolve this?', 'Show fair options'])('requests plans: %s', (text) => {
    expect(routeIntent(text)).toEqual({ kind: 'plans' });
  });
  it.each([['Choose the first plan', 0], ['Select option two', 1], ['Alexa, the second one', 1], ['Hey Alexa, the third plan', 2], ['pick plan 3', 2]] as const)('selects an explicit option: %s', (text, index) => {
    expect(routeIntent(text)).toEqual({ kind: 'choose', index });
  });
  it('distinguishes stored agreements from the fairness ledger', () => {
    expect(routeIntent('What did we agree?')).toEqual({ kind: 'agreements' });
    expect(routeIntent('Who has yielded the most?')).toEqual({ kind: 'ledger' });
  });
  it.each(['Who gets the living room tonight?', 'Hey Alexa, who gets the living room tonight?', 'Resolve the evening conflict', 'Find a fair plan for tonight'])('requests evening options: %s', text => {
    expect(routeIntent(text)).toEqual({ kind: 'evening' });
  });
  it.each(['Is it fair?', 'Alexa, is this fair?', 'Hey Alexa is that fair?', 'How fair is this?'])('requests the fairness ledger: %s', text => {
    expect(routeIntent(text)).toEqual({ kind: 'ledger' });
  });
  it('understands the canonical change and close variants', () => {
    expect(routeIntent("Leo's meeting runs 30 minutes late")).toEqual({ kind: 'change', minutes: 30 });
    expect(routeIntent('The meeting is extended by 45 minutes')).toEqual({ kind: 'change', minutes: 45 });
    expect(routeIntent('Leo is running late')).toEqual({ kind: 'change', minutes: 30 });
    expect(routeIntent("Hey Alexa, Leo's meeting runs 30 minutes late")).toEqual({ kind: 'change', minutes: 30 });
  });
  it('rejects unsupported time increments instead of changing the request', () => {
    expect(routeIntent('Extend the meeting 17 minutes')).toEqual({ kind: 'unknown' });
    expect(routeIntent('Extend the meeting 150 minutes')).toEqual({ kind: 'unknown' });
  });
  it('keeps accept, decline, and cancel distinct', () => {
    expect(routeIntent('I agree')).toEqual({ kind: 'consent', action: 'accept' });
    expect(routeIntent('No')).toEqual({ kind: 'consent', action: 'decline' });
    expect(routeIntent('Cancel')).toEqual({ kind: 'consent', action: 'cancel' });
    expect(routeIntent('Hey Alexa, I agree please')).toEqual({ kind: 'consent', action: 'accept' });
    expect(routeIntent('Alexa, no')).toEqual({ kind: 'consent', action: 'decline' });
    expect(routeIntent('Hey Alexa cancel please')).toEqual({ kind: 'consent', action: 'cancel' });
  });
  it('supports recovery without treating reconnect as a reset', () => {
    expect(routeIntent('Reconnect')).toEqual({ kind: 'reconnect' });
    expect(routeIntent('The server restarted')).toEqual({ kind: 'reconnect' });
    expect(routeIntent('Reset demo')).toEqual({ kind: 'reset' });
  });
  it('returns unknown for unsupported requests', () => {
    expect(routeIntent('Order laundry detergent')).toEqual({ kind: 'unknown' });
    expect(routeIntent('')).toEqual({ kind: 'unknown' });
    expect(routeIntent('Alexa')).toEqual({ kind: 'unknown' });
    expect(routeIntent('Hey Alexa')).toEqual({ kind: 'unknown' });
  });
});
