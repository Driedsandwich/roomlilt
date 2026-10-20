import { randomUUID } from 'node:crypto';
import { afterAll, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import { createApplication } from '../src/server/app.js';

let app: Awaited<ReturnType<typeof createApplication>>;
let window: Window;

afterAll(async () => {
  window?.dispatchEvent(new window.Event('pagehide'));
  await app?.close();
  await window?.happyDOM.close();
  vi.unstubAllGlobals();
});

it('shows fairness deciding the evening plan, obtains named consent, and preserves both agreements through restart and repair', async () => {
  const dataFile = `data/tests/client-${randomUUID()}.json`;
  app = await createApplication({ dataFile });
  const { url, port } = await app.listen(0);
  window = new Window({ url: url.replace('/mcp', '/') });
  window.document.body.innerHTML = '<div id="app"></div>';
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', window.document);
  await import('../src/client/main.js');
  // Bridge the simulator's extended DOM types to the browser API used by the display.
  const document = window.document as unknown as Document;
  const ready = async () => vi.waitFor(() => expect(document.querySelector<HTMLInputElement>('#utterance')!.disabled).toBe(false));
  const click = async (selector: string) => {
    await vi.waitFor(() => {
      const element = document.querySelector<HTMLButtonElement>(selector);
      expect(element).toBeTruthy();
      expect(element!.disabled).toBe(false);
    });
    document.querySelector<HTMLButtonElement>(selector)!.click();
  };
  const utter = async (text: string) => {
    await ready();
    const input = document.querySelector<HTMLInputElement>('#utterance')!;
    input.value = text;
    document.querySelector<HTMLFormElement>('#utterance-form')!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }) as unknown as Event);
  };
  const consent = async (member: string, action: 'accept' | 'decline' | 'cancel') => {
    await vi.waitFor(() => expect(document.querySelector<HTMLDialogElement>('#consent-dialog')!.open).toBe(true));
    expect(document.querySelector('#consent-title')!.textContent).toContain(member);
    await click(`[data-consent="${action}"]`);
    await ready();
  };

  await vi.waitFor(() => expect(document.querySelector('#connection-label')!.textContent).toBe('Connected locally'));
  const initial = app.store.snapshot();
  await utter('Alexa, find a fair plan');
  await ready();
  expect(document.querySelectorAll('.plan-card').length).toBeGreaterThan(0);
  expect(document.querySelectorAll('.plan-card').length).toBeLessThanOrEqual(3);
  expect(document.querySelector('.plan-card')!.textContent).toContain('Required yield');
  await click('.plan-card.recommended [data-plan]');
  await consent('Sam', 'decline');
  expect(app.store.snapshot()).toEqual(initial);
  await click('.plan-card.recommended [data-plan]');
  await consent('Sam', 'cancel');
  expect(app.store.snapshot()).toEqual(initial);
  await click('.plan-card.recommended [data-plan]');
  await consent('Sam', 'accept');
  expect(document.querySelectorAll('.agreement-card')).toHaveLength(1);
  expect(document.querySelector('.agreement-list')!.textContent).toContain('14:00–16:00');
  expect(document.querySelector('.evening-nudge')!.textContent).toContain("Compare tonight's plans");
  const morning = app.store.snapshot();
  expect(morning.ledger.find(entry => entry.memberId === 'sam')).toMatchObject({ yieldCount: 9, requiredYields: 7, negotiatedYields: 2, effortPoints: 20 });

  await utter('Hey Alexa, who gets the living room tonight?');
  await ready();
  const cards = [...document.querySelectorAll<HTMLElement>('.plan-card')];
  expect(cards.length).toBeGreaterThanOrEqual(2);
  expect(cards.length).toBeLessThanOrEqual(3);
  expect(new Set(cards.map(card => card.querySelector('h3')!.textContent)).size).toBe(cards.length);
  const fairest = cards.find(card => [...card.querySelectorAll('.plan-badge')].some(badge => badge.textContent === 'Fairest'))!;
  const lowest = cards.find(card => [...card.querySelectorAll('.plan-badge')].some(badge => badge.textContent === 'Lowest disruption'))!;
  expect(fairest).not.toBe(lowest);
  expect(fairest.classList.contains('recommended')).toBe(true);
  expect(fairest.querySelector('.plan-reason')!.textContent).toMatch(/Sam.*9.*Leo.*once/);
  expect(fairest.querySelector('.plan-changes')!.textContent).toContain('Leo');
  expect(fairest.querySelector('.room-change')!.textContent).toContain('Living room → Private study');
  expect(lowest.querySelector('.plan-changes')!.textContent).toContain('Sam');
  expect(lowest.querySelector('.time-change')!.textContent).toContain('20:00–22:00');
  const score = (card: Element, index: number) => Number(card.querySelectorAll('.plan-scores b')[index].textContent);
  expect(score(lowest, 0)).toBeLessThan(score(fairest, 0));
  expect(score(fairest, 1)).toBeLessThan(score(lowest, 1));
  lowest.querySelector<HTMLButtonElement>('[data-plan]')!.click();
  await consent('Sam', 'decline');
  expect(app.store.snapshot()).toEqual(morning);
  await click('.plan-card.recommended [data-plan]');
  await consent('Leo', 'accept');
  const saved = app.store.snapshot();
  expect(saved.agreements).toHaveLength(2);
  expect(saved.activities.find(activity => activity.id === 'sam-game')?.start).toBe(19 * 60);
  expect(saved.activities.find(activity => activity.id === 'leo-reading')?.resourceId).toBe('private-study');
  await utter('Is it fair?');
  await ready();
  expect(document.querySelector('.ledger-list')!.textContent).toContain('required');
  expect(document.querySelector('[data-member="sam"]')!.textContent).toContain('9');
  expect(document.querySelector('[data-member="sam"]')!.textContent).toContain('7 required · 2 negotiated');
  expect(document.querySelector('[data-member="sam"]')!.textContent).toContain('20 effort points');
  expect(document.querySelector('.ledger-list')!.textContent).not.toContain('minutes');

  await app.close();
  app = await createApplication({ dataFile });
  await app.listen(port);
  await click('#reconnect');
  await ready();
  await vi.waitFor(() => expect(document.querySelectorAll('.agreement-card')).toHaveLength(2));
  expect(app.store.snapshot()).toEqual(saved);
  await utter("Leo's meeting runs 30 minutes late");
  await ready();
  expect(document.querySelector('.kept-agreements')!.textContent).toContain('2 earlier agreements kept');
  expect(document.querySelector('.kept-agreements')!.textContent).toContain('Laundry');
  expect(document.querySelector('.kept-agreements')!.textContent).toContain('Evening reading');
  expect(document.querySelector('.plan-card.recommended .plan-changes')!.textContent).toContain('Video meeting');
  expect(document.querySelector('.plan-card.recommended .plan-changes')!.textContent).not.toContain('Laundry');
  await click('.plan-card.recommended [data-plan]');
  await consent('Leo', 'accept');
  expect(document.querySelectorAll('.agreement-card')).toHaveLength(3);
  const repaired = app.store.snapshot();
  for (const id of ['sam-laundry', 'sam-class', 'sam-game', 'leo-reading']) {
    expect(repaired.activities.find(activity => activity.id === id)).toEqual(saved.activities.find(activity => activity.id === id));
  }
  expect(repaired.activities.find(activity => activity.id === 'leo-meeting')).toMatchObject({ end: 690, resourceId: 'private-study' });
  for (const agreement of saved.agreements) expect(repaired.agreements.find(item => item.id === agreement.id)).toEqual(agreement);
  await utter("What's clashing today?");
  await ready();
  expect(document.querySelectorAll('.conflict-card')).toHaveLength(0);
  const protocol = document.querySelector('#protocol-traffic')!.textContent!;
  for (const expected of ['2025-11-25', 'initialize', 'tools/list', 'tools/call', 'elicitation/create']) expect(protocol).toContain(expected);
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  window.dispatchEvent(new window.Event('pagehide'));
  await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({
    method: 'DELETE', keepalive: true,
    headers: expect.objectContaining({ 'Mcp-Session-Id': expect.any(String), 'MCP-Protocol-Version': '2025-11-25' }),
  })));
  const deleted = fetchSpy.mock.calls.find(([, options]) => options?.method === 'DELETE' && options.keepalive);
  const sessionId = (deleted![1]!.headers as Record<string, string>)['Mcp-Session-Id'];
  await vi.waitFor(async () => {
    expect((await fetch(url, { method: 'DELETE', headers: { 'Mcp-Session-Id': sessionId } })).status).toBe(404);
  });
  fetchSpy.mockRestore();
}, 15000);
