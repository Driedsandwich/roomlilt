import './style.css';
import { HouseholdClient, type ProtocolEntry } from './mcp.js';
import { routeIntent } from './intent-router.js';
import type { ElicitRequest, ElicitResult } from '@modelcontextprotocol/sdk/types.js';
import type { Activity, Conflict, HouseholdState, LedgerEntry, MemberId, Plan, ToolData } from '../shared/types.js';

const escapeHtml = (value: unknown): string => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const time = (minute: number): string => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const span = (activity: Activity): string => `${time(activity.start)}–${time(activity.end)}`;
const name = (id: MemberId): string => state?.members.find((member) => member.id === id)?.name || id;
const resourceName = (id: string): string => state?.resources.find((resource) => resource.id === id)?.name || id;
const icon = (kind: string): string => {
  const paths: Record<string, string> = {
    leaf: '<path d="M20 4C10 3 4 7 4 14a6 6 0 0 0 6 6c7 0 11-6 10-16Z"/><path d="m5 19 10-10"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    mic: '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/>',
    arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    balance: '<path d="M12 3v18m-4 0h8M4 7h16M4 7l-3 7h6L4 7Zm16 0-3 7h6l-3-7Z"/>',
    sound: '<path d="m11 5-6 4H2v6h3l6 4V5Zm4 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  };
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[kind] || paths.leaf}</svg>`;
};

let state: HouseholdState | undefined;
let ledger: LedgerEntry[] = [];
let conflicts: Conflict[] = [];
let plans: Plan[] = [];
let keptAgreementIds: string[] = [];
let view: 'today' | 'plans' | 'agreements' | 'ledger' = 'today';
let connected = false;
let busy = false;
let connecting = false;
let voiceEnabled = false;
let protocolVersion = '';
let toolCount = 0;
let trafficCount = 0;
let consentResolve: ((result: ElicitResult) => void) | undefined;
let consentMember: MemberId | undefined;
const traffic: ProtocolEntry[] = [];
const requestMethods = new Map<string | number, string>();
const messages: { role: 'assistant' | 'user'; text: string }[] = [
  { role: 'assistant', text: "Good morning. Everyone needs a little room today. Let's find a plan that feels fair." },
];

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <header class="topbar">
    <a class="brand" href="/" aria-label="RoomLilt home"><span class="brand-mark">${icon('leaf')}</span>RoomLilt<span class="brand-dot">.</span></a>
    <span class="header-caption">A LITTLE MORE ROOM FOR EVERYONE</span>
    <div class="connection"><span id="connection-dot" class="status-dot"></span><span id="connection-label" role="status">Connecting locally</span><button id="reconnect" class="text-button">Reconnect</button></div>
  </header>
  <main class="workspace">
    <section class="household" aria-label="Household coordination">
      <div class="household-heading"><span class="eyebrow">THE EVERYDAY, BETTER TOGETHER</span><span class="fictional-badge">Fictional household</span></div>
      <div id="dashboard" aria-live="polite"></div>
    </section>
    <aside class="conversation-panel" aria-label="Conversation">
      <div class="conversation-heading"><div class="assistant-symbol">${icon('leaf')}</div><div><span class="eyebrow">YOUR HOUSEHOLD MEDIATOR</span><h2>Let's work it out.</h2></div><button id="voice-toggle" class="icon-button" aria-label="Turn spoken responses on" aria-pressed="false" title="Turn spoken responses on">${icon('sound')}</button></div>
      <div class="conversation-status"><span class="tiny-dot"></span> LOCAL INTELLIGENCE. SHARED UNDERSTANDING.</div>
      <div id="messages" class="messages" aria-live="polite" aria-relevant="additions"></div>
      <div id="working" class="working" role="status" hidden><span></span><span></span><span></span><span class="working-label">Finding common ground</span></div>
      <div class="conversation-bottom">
        <p class="try-label">A GOOD PLACE TO START</p>
        <div class="suggestions">
          <button data-utterance="What's clashing today?">What's clashing today? <span>↗</span></button>
          <button data-utterance="Find a fair plan">Find a fair plan <span>↗</span></button>
          <button data-utterance="Who gets the living room tonight?">Who gets the living room tonight? <span>↗</span></button>
          <button data-utterance="Is it fair?">Is it fair? <span>↗</span></button>
          <button data-utterance="What did we agree?">What did we agree? <span>↗</span></button>
          <button data-utterance="Leo's meeting runs 30 minutes late">Leo's meeting runs 30 minutes late <span>↗</span></button>
        </div>
        <form id="utterance-form" class="composer"><label class="sr-only" for="utterance">Talk to RoomLilt</label><input id="utterance" autocomplete="off" placeholder="Or tell me what's happening…" maxlength="300"/><button id="microphone" type="button" class="icon-button" aria-label="Use microphone" title="Use microphone">${icon('mic')}</button><button id="send" class="send-button" type="submit" aria-label="Send message">${icon('arrow')}</button></form>
        <p id="speech-hint" class="speech-hint">Type or choose a suggestion. No microphone required.</p>
      </div>
    </aside>
  </main>
  <section class="protocol-section" aria-label="MCP connection details"><details id="protocol-inspector"><summary><span class="protocol-title"><span class="code-mark">&lt;/&gt;</span> Protocol inspector <span id="protocol-count">0 messages</span></span><span id="protocol-version">REAL MCP · STREAMABLE HTTP</span></summary><div class="protocol-description">Unmodified JSON-RPC messages from the SDK transport. Your household stays on this computer.</div><div id="protocol-traffic" class="protocol-traffic"></div></details></section>
  <footer>Simulated Alexa+-style experience for the Build, Ship, Shape hackathon. Not affiliated with or endorsed by Amazon. All household data is fictional.</footer>
  <dialog id="consent-dialog" aria-labelledby="consent-title" aria-describedby="consent-description"><div id="consent-body"></div></dialog>
`;

const dashboard = document.querySelector<HTMLDivElement>('#dashboard')!;
const consentDialog = document.querySelector<HTMLDialogElement>('#consent-dialog')!;
const client = new HouseholdClient(logTraffic, showConsent, () => {
  connected = false;
  finishConsent('cancel');
  busy = false;
  renderStatus();
});

function renderStatus(): void {
  document.querySelector('#connection-dot')!.classList.toggle('online', connected);
  document.querySelector('#connection-label')!.textContent = connecting ? 'Connecting locally' : connected ? 'Connected locally' : 'Server disconnected';
  document.querySelector<HTMLButtonElement>('#reconnect')!.disabled = busy || connecting;
  document.querySelector('#working')!.toggleAttribute('hidden', !busy);
  document.querySelector<HTMLInputElement>('#utterance')!.disabled = busy;
  document.querySelector<HTMLButtonElement>('#send')!.disabled = busy;
  document.querySelector<HTMLButtonElement>('#microphone')!.disabled = busy || !recognition;
  document.querySelectorAll<HTMLButtonElement>('[data-utterance], [data-plan], [data-action="reset"]').forEach((button) => { button.disabled = busy || !connected; });
}

function speak(text: string): void {
  if (!voiceEnabled || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = 0.95;
  window.speechSynthesis.speak(utterance);
}

function say(text: string, role: 'assistant' | 'user' = 'assistant'): void {
  messages.push({ role, text });
  renderMessages();
  if (role === 'assistant') speak(text);
}

function renderMessages(): void {
  const container = document.querySelector<HTMLDivElement>('#messages')!;
  container.innerHTML = messages.slice(-12).map((message) => `<div class="message ${message.role}"><span class="message-author">${message.role === 'assistant' ? 'ROOMLILT' : 'YOU'}</span><p>${escapeHtml(message.text)}</p></div>`).join('');
  container.scrollTop = container.scrollHeight;
}

function logTraffic(entry: ProtocolEntry): void {
  trafficCount += 1;
  traffic.push(entry);
  if (traffic.length > 80) traffic.shift();
  document.querySelector('#protocol-count')!.textContent = `${trafficCount} messages`;
  const message = Array.isArray(entry.message) ? entry.message[0] : entry.message;
  if ('method' in message && 'id' in message) requestMethods.set(message.id, message.method);
  const label = 'method' in message ? message.method : `${'error' in message ? 'error' : 'result'} · ${message.id === undefined ? '' : requestMethods.get(message.id) || ''} · #${message.id}`;
  const item = document.createElement('details');
  item.className = `protocol-entry ${entry.direction}`;
  item.innerHTML = `<summary><span>${entry.direction === 'sent' ? '↑ CLIENT → SERVER' : '↓ SERVER → CLIENT'}</span><strong>${escapeHtml(label)}</strong><time>${entry.time}</time></summary><pre>${escapeHtml(JSON.stringify(entry.message, null, 2))}</pre>`;
  const container = document.querySelector('#protocol-traffic')!;
  container.append(item);
  if (container.children.length > 80) container.firstElementChild!.remove();
  container.scrollTop = container.scrollHeight;
}

function memberRow(): string {
  return `<div class="members">${(state?.members || []).map((member) => `<div class="member"><span class="avatar ${escapeHtml(member.id)}">${escapeHtml(member.name[0])}</span><span><strong>${escapeHtml(member.name)}</strong><small title="${escapeHtml(member.description)}">${escapeHtml(member.description.split(';')[0])}</small></span></div>`).join('')}</div>`;
}

function render(): void {
  if (!state) {
    dashboard.innerHTML = `<div class="intro"><h1>A free slot isn't<br/>always a <em>fair slot.</em></h1><p>One home. Different rhythms.<br/>A little understanding goes a long way.</p></div><div class="loading-card">${icon('leaf')}<div><h2>${connecting ? 'Making a little room…' : 'Your home is a connection away.'}</h2><p>${connecting ? 'Connecting to your local household server.' : 'Start the local server, then choose Reconnect.'}</p></div></div>`;
    return;
  }
  const date = new Date(`${state.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const tabs = [['today', 'Today'], ['plans', 'Fair plans'], ['agreements', 'Agreements'], ['ledger', 'Fairness ledger']] as const;
  dashboard.innerHTML = `<div class="intro"><div><h1>A free slot isn't<br/>always a <em>fair slot.</em></h1><p>One home. Different rhythms. Let's make room for everyone.</p></div><div class="day-marker">${icon('sun')}<span>${escapeHtml(date)}</span><small>YOUR SHARED DAY</small></div></div>${memberRow()}<nav class="board-tabs" aria-label="Household views">${tabs.map(([id, label]) => `<button data-view="${id}" class="${view === id ? 'active' : ''}" aria-current="${view === id ? 'page' : 'false'}">${label}${id === 'agreements' && state!.agreements.some((agreement) => agreement.status === 'active') ? '<span class="tab-notice"></span>' : ''}</button>`).join('')}</nav><div class="board-content">${view === 'today' ? todayView() : view === 'plans' ? plansView() : view === 'agreements' ? agreementsView() : ledgerView()}</div><div class="board-footnote"><span>${icon('leaf')} Fairness means asking, not assuming.</span><button data-action="reset" class="text-button">Reset demo</button></div>`;
  renderStatus();
}

function todayView(): string {
  const ordered = [...state!.activities].sort((a, b) => a.start - b.start);
  return `<div class="section-heading"><div><span class="eyebrow">A FEW THINGS NEED SPACE</span><h2>${conflicts.length ? `${conflicts.length} overlaps. One conversation.` : 'Different rhythms, one home.'}</h2></div><button class="small-action" data-utterance="What's clashing today?">Check overlaps ${icon('arrow')}</button></div>${conflicts.length ? `<div class="conflict-list">${conflicts.map((conflict) => `<article class="conflict-card"><div class="conflict-icon">${icon('sound')}</div><div><div class="conflict-top"><h3>${escapeHtml(conflict.title)}</h3><span>${time(conflict.start)}–${time(conflict.end)}</span></div><p>${escapeHtml(conflict.description)}</p></div></article>`).join('')}</div><button class="primary find-plan" data-utterance="Find a fair plan">Let's find a fair plan ${icon('arrow')}</button>` : `<div class="schedule-list">${ordered.map((activity) => `<div class="schedule-item"><time>${span(activity)}</time><span class="activity-line ${activity.memberId}"></span><div><strong>${escapeHtml(activity.title)}</strong><span>${name(activity.memberId)} <span class="schedule-separator">·</span> ${escapeHtml(state!.resources.find((resource) => resource.id === activity.resourceId)?.name || activity.resourceId)}</span></div>${activity.fixed ? '<span class="protected-badge">Protected</span>' : ''}</div>`).join('')}</div>`}`;
}

function plansView(): string {
  if (!plans.length) return `<div class="empty-card">${icon('balance')}<span class="eyebrow">LESS FRICTION. MORE FAIRNESS.</span><h2>A plan everyone has a say in.</h2><p>We'll compare the options, show who would change what, and ask before anything is agreed.</p><button class="primary" data-utterance="Find a fair plan">Find a fair plan ${icon('arrow')}</button></div>`;
  return `<div class="section-heading"><div><span class="eyebrow">A CHOICE, NOT AN ASSUMPTION</span><h2>${keptAgreementIds.length || plans[0].affectedAgreementIds.length ? 'A small change. A fair adjustment.' : `${plans.length} ways to make room.`}</h2></div><span class="subtle-note">Consent comes next</span></div>${keptAgreementsView()}<div class="plans-grid">${plans.map((plan, index) => `<article class="plan-card ${plan.recommended ? 'recommended' : ''}" data-plan-id="${escapeHtml(plan.id)}"><div class="plan-top"><span class="eyebrow">OPTION ${String(index + 1).padStart(2, '0')}</span><div class="plan-badges">${plan.recommended ? '<span class="recommended-badge">Recommended</span>' : ''}${plan.badges.map((badge) => `<span class="plan-badge">${escapeHtml(badge)}</span>`).join('')}</div></div><h3>${escapeHtml(plan.title)}</h3><p class="plan-reason">${escapeHtml(plan.reason)}</p><div class="plan-scores"><span>Disruption <b>${plan.disruptionScore}</b></span><span>Fairness-aware score <b>${plan.score}</b></span></div><div class="plan-changes">${plan.changes.map((change) => `<div class="plan-change"><span class="avatar tiny ${escapeHtml(change.memberId)}">${escapeHtml(name(change.memberId)[0])}</span><div><strong>${escapeHtml(name(change.memberId))} <span>${escapeHtml(change.after.title)}</span></strong><div class="time-change"><del>${span(change.before)}</del><span>→</span><b>${span(change.after)}</b></div><small class="room-change">${escapeHtml(resourceName(change.before.resourceId))}${change.before.resourceId !== change.after.resourceId ? ` → ${escapeHtml(resourceName(change.after.resourceId))}` : ' · room kept'}</small>${change.before.mode !== change.after.mode && change.after.mode ? `<small>${escapeHtml(change.after.mode)}</small>` : ''}<small class="yield-type">${change.yieldType === 'required' ? 'Required yield · protected need' : 'Negotiated yield'} · ${change.effortPoints} effort points</small></div></div>`).join('')}</div><div class="plan-impact">${icon('balance')}<span>${projectedLedger(plan)}</span></div><button class="${plan.recommended ? 'primary' : 'secondary'}" data-plan="${escapeHtml(plan.id)}">Choose option ${index + 1} ${icon('arrow')}</button></article>`).join('')}</div><p class="consent-note">${icon('check')} No plan is saved until every member making a change agrees.</p><p class="ledger-definition">Last 14 days, including today. Required yields count toward fairness. Effort is bounded at 1–3 points per activity; lower disruption and fairness-aware scores are better.</p>`;
}

const plural = (count: number, word: string) => `${count} ${count === 1 ? word : `${word}s`}`;

function projectedLedger(plan: Plan): string {
  return ledger.map((current) => {
    const impact = plan.ledgerImpact.find((entry) => entry.memberId === current.memberId);
    return `<span class="projected-member"><strong>${escapeHtml(name(current.memberId))}</strong> ${current.yieldCount} → ${plural(current.yieldCount + (impact?.yieldCount || 0), 'yield')} <span>· ${current.requiredYields + (impact?.requiredYields || 0)} required / ${current.negotiatedYields + (impact?.negotiatedYields || 0)} negotiated · ${Number((current.effortPoints + (impact?.effortPoints || 0)).toFixed(2))} effort</span></span>`;
  }).join('');
}

function keptAgreementsView(): string {
  const kept = state!.agreements.filter((agreement) => keptAgreementIds.includes(agreement.id) && agreement.status === 'active');
  if (!kept.length) return '';
  return `<div class="kept-agreements" role="status"><strong>${icon('check')} ${kept.length} earlier agreement${kept.length === 1 ? '' : 's'} kept</strong><ul>${kept.map((agreement) => `<li>${escapeHtml(agreement.title)}${agreement.changes.map((change) => ` · ${escapeHtml(change.after.title)} ${span(change.after)} · ${escapeHtml(resourceName(change.after.resourceId))}`).join('')}</li>`).join('')}</ul></div>`;
}

function agreementsView(): string {
  const agreements = state!.agreements.filter((agreement) => agreement.status === 'active');
  const eveningPending = state!.activities.some((activity) => activity.start >= 18 * 60 && !activity.fixed && state!.activities.some((other) => other.id !== activity.id && other.resourceId === activity.resourceId && other.start < activity.end && activity.start < other.end));
  return `<div class="section-heading"><div><span class="eyebrow">REMEMBERED, NOT REPEATED</span><h2>${agreements.length ? 'Our common ground.' : 'Good agreements start with a choice.'}</h2></div>${agreements.length ? '<span class="saved-badge">✓ Saved locally</span>' : ''}</div>${keptAgreementsView()}${agreements.length ? `<div class="agreement-list">${agreements.map((agreement) => `<article class="agreement-card"><div class="agreement-title"><span class="agreement-check">${icon('check')}</span><h3>${escapeHtml(agreement.title)}</h3></div>${agreement.changes.map((change) => `<div class="agreed-change"><span class="avatar tiny ${escapeHtml(change.memberId)}">${escapeHtml(name(change.memberId)[0])}</span><div><strong>${escapeHtml(change.after.title)}</strong><span>${escapeHtml(name(change.memberId))} · ${span(change.after)} · ${escapeHtml(resourceName(change.after.resourceId))}${change.after.mode ? ` · ${escapeHtml(change.after.mode)}` : ''}</span><small>${change.yieldType === 'required' ? 'Required yield · protected need' : 'Negotiated yield'} · ${change.effortPoints} effort points</small></div></div>`).join('')}<p class="agreement-consent">Agreed by ${agreement.acceptedBy.map((id) => escapeHtml(name(id))).join(', ')}. Kept across server restarts.</p></article>`).join('')}</div>${eveningPending ? `<div class="change-nudge evening-nudge"><div>${icon('balance')}<span>Morning agreed. Tonight still needs a fair choice.</span></div><button class="small-action" data-utterance="Who gets the living room tonight?">Compare tonight's plans ${icon('arrow')}</button></div>` : ''}<div class="change-nudge"><div>${icon('clock')}<span>Life changes. The whole day doesn't have to.</span></div><button class="small-action" data-utterance="Leo's meeting runs 30 minutes late">Report a late meeting ${icon('arrow')}</button></div>` : `<div class="empty-card compact">${icon('leaf')}<p>Choose a fair plan and ask the people who would make room. Your agreement will be saved here.</p><button class="primary" data-utterance="Find a fair plan">Explore fair plans ${icon('arrow')}</button></div>`}`;
}

function ledgerView(): string {
  const max = Math.max(1, ...ledger.map((entry) => entry.yieldCount));
  return `<div class="section-heading"><div><span class="eyebrow">THE LITTLE THINGS ADD UP</span><h2>Who has been making room?</h2></div><span class="subtle-note">Last 14 days, including today</span></div><p class="ledger-explainer">Every yield counts toward fairness, including a required change that protects sleep or health. Negotiated changes share the next flexible choice. Effort adds 1–3 points per changed activity, capped so a long time shift cannot swamp the history.</p><div class="ledger-list">${ledger.map((entry) => `<article class="ledger-member" data-member="${escapeHtml(entry.memberId)}"><div class="ledger-person"><span class="avatar ${escapeHtml(entry.memberId)}">${escapeHtml(name(entry.memberId)[0])}</span><div><h3>${escapeHtml(name(entry.memberId))}</h3><span>${entry.requiredYields} required · ${entry.negotiatedYields} negotiated</span><small class="ledger-effort">${entry.effortPoints} effort points</small></div><strong>${entry.yieldCount}<small>${entry.yieldCount === 1 ? 'yield' : 'yields'} / 14 days</small></strong></div><div class="ledger-track"><span class="${escapeHtml(entry.memberId)}" style="width:${Math.max(3, entry.yieldCount / max * 100)}%"></span></div></article>`).join('')}</div><div class="fairness-insight">${icon('balance')}<p>A protected need can require a yield. The next flexible decision should remember it. Everyone still gets the final say.</p></div>`;
}

function absorb(data: ToolData): void {
  if (data.state) state = data.state;
  if (data.ledger) ledger = data.ledger;
  else if (data.state) ledger = data.state.ledger;
  if (data.conflicts) conflicts = data.conflicts;
  if (data.plans) plans = data.plans;
  if (data.keptAgreementIds) keptAgreementIds = data.keptAgreementIds;
  render();
}

async function call(name: string, args: Record<string, unknown> = {}): Promise<ToolData> {
  const data = await client.call(name, args);
  absorb(data);
  return data;
}

async function connect(announce = false): Promise<void> {
  connecting = true;
  busy = true;
  connected = false;
  renderStatus();
  render();
  try {
    const info = await client.connect();
    protocolVersion = info.protocolVersion;
    toolCount = info.toolNames.length;
    connected = true;
    document.querySelector('#protocol-version')!.textContent = `MCP ${protocolVersion} · ${toolCount} TOOLS · STREAMABLE HTTP`;
    await call('get_household_state');
    await call('get_fairness_ledger');
    if (announce) {
      view = 'agreements';
      render();
      say('Reconnected. Your saved agreements and fairness history are still here.');
    }
  } catch (error) {
    connected = false;
    say(`I couldn't connect to the local household server. ${error instanceof Error ? error.message : String(error)} Start it with npm run dev, then choose Reconnect.`);
  } finally {
    busy = false;
    connecting = false;
    render();
    renderStatus();
  }
}

async function findPlans(eveningOnly = false): Promise<void> {
  if (!state) return;
  const found = await call('find_conflicts', { date: state.date });
  const conflict = eveningOnly ? found.conflicts?.find((candidate) => candidate.start >= 18 * 60) : found.conflicts?.[0];
  if (!conflict) {
    plans = [];
    view = 'today';
    say(eveningOnly ? 'No evening clash remains. Your earlier agreements are kept.' : found.message);
    return;
  }
  keptAgreementIds = [];
  const result = await call('propose_plans', { conflictId: conflict.id, date: conflict.date });
  view = 'plans';
  say(result.message);
}

async function choosePlan(plan: Plan): Promise<void> {
  const result = await call('commit_plan', { planId: plan.id });
  if (result.committed) {
    plans = [];
    conflicts = [];
    view = 'agreements';
    if (!result.state) await call('get_household_state');
  }
  say(result.message);
  if (result.committed && state?.activities.some((activity) => activity.start >= 18 * 60 && state!.activities.some((other) => other.id !== activity.id && other.resourceId === activity.resourceId && other.start < activity.end && activity.start < other.end))) {
    say('Morning agreed. There is still a flexible evening choice. Ask “Who gets the living room tonight?” to compare the fairest plan with the lowest-disruption plan.');
  }
}

async function runUtterance(text: string, chosenPlan?: Plan): Promise<void> {
  if (busy) return;
  const intent = chosenPlan ? { kind: 'choose' as const, index: plans.indexOf(chosenPlan) } : routeIntent(text);
  say(text, 'user');
  if (intent.kind === 'reconnect') { await connect(true); return; }
  if (intent.kind === 'unknown') {
    say("I can check clashes, find a fair plan, show agreements or the fairness ledger, and adjust for Leo's late meeting. Try one of the suggestions below.");
    return;
  }
  if (intent.kind === 'consent') {
    say('Consent is a personal choice. Choose a plan first, then use the named consent prompt to accept, decline, or cancel.');
    return;
  }
  if (!connected) { say('The local server is disconnected. Choose Reconnect after restarting it; your saved agreements will be kept.'); return; }
  busy = true;
  renderStatus();
  try {
    if (intent.kind === 'conflicts') {
      const result = await call('find_conflicts', { date: state!.date });
      view = 'today';
      say(result.message);
    } else if (intent.kind === 'plans') {
      await findPlans();
    } else if (intent.kind === 'evening') {
      await findPlans(true);
    } else if (intent.kind === 'choose') {
      const plan = plans[intent.index];
      if (plan) await choosePlan(plan);
      else say('Find a fair plan first, then choose one of the options shown.');
    } else if (intent.kind === 'agreements') {
      const result = await call('get_household_state');
      view = 'agreements';
      const count = state!.agreements.filter((agreement) => agreement.status === 'active').length;
      say(count ? `${count} saved agreement${count === 1 ? '' : 's'}. Here's what everyone agreed to. These are saved locally, even after the server restarts.` : result.message + ' No agreements have been saved yet.');
    } else if (intent.kind === 'ledger') {
      const result = await call('get_fairness_ledger');
      view = 'ledger';
      say(result.message);
    } else if (intent.kind === 'change') {
      const result = await call('report_change', { activityId: 'leo-meeting', change: 'extend', minutes: intent.minutes });
      view = result.plans?.length ? 'plans' : 'agreements';
      say(result.message);
    } else if (intent.kind === 'reset') {
      const result = await call('reset_demo');
      conflicts = [];
      plans = [];
      keptAgreementIds = [];
      view = 'today';
      say(result.message);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/fetch|session|connect|closed|404|network|failed to post/i.test(message)) connected = false;
    say(`That request didn't finish. ${message}${connected ? ' You can try again.' : ' Choose Reconnect after the local server is running.'}`);
  } finally {
    busy = false;
    render();
    renderStatus();
  }
}

function finishConsent(action: 'accept' | 'decline' | 'cancel'): void {
  const resolve = consentResolve;
  if (!resolve) return;
  consentResolve = undefined;
  const memberId = consentMember;
  consentMember = undefined;
  consentDialog.close();
  resolve(action === 'accept' && memberId ? { action: 'accept', content: { consent: true, memberId } } : { action });
}

function showConsent(request: ElicitRequest, signal?: AbortSignal): Promise<ElicitResult> {
  if (signal?.aborted) return Promise.resolve({ action: 'cancel' });
  if (request.params.mode === 'url') return Promise.resolve({ action: 'decline' });
  const properties = request.params.requestedSchema.properties as Record<string, { enum?: string[]; default?: string }>;
  const rawMember = properties.memberId?.enum?.[0] || properties.memberId?.default;
  if (!rawMember || !state?.members.some((member) => member.id === rawMember)) return Promise.resolve({ action: 'decline' });
  const memberId = rawMember as MemberId;
  consentMember = memberId;
  const memberName = name(memberId);
  document.querySelector('#consent-body')!.innerHTML = `<div class="consent-eyebrow"><span class="avatar ${escapeHtml(memberId)}">${escapeHtml(memberName[0])}</span><span>THIS CHOICE BELONGS TO ${escapeHtml(memberName.toUpperCase())}</span></div><h2 id="consent-title">${escapeHtml(memberName)}, does this work for you?</h2><p class="consent-intro">A fair plan needs your say.</p><div id="consent-description" class="consent-description">${escapeHtml(request.params.message)}</div><p class="consent-assurance">Accept only if you're ${escapeHtml(memberName)} and agree to these changes. Declining or cancelling keeps this plan uncommitted.</p><div class="consent-actions"><button data-consent="accept" class="primary">I’m ${escapeHtml(memberName)} — accept ${icon('check')}</button><button data-consent="decline" class="secondary">Decline</button><button data-consent="cancel" class="text-button">Cancel</button></div><span class="elicitation-label">MCP ELICITATION · FORM MODE · EXPLICIT CONSENT</span>`;
  consentDialog.showModal();
  speak(`${memberName}, does this work for you? ${request.params.message}`);
  return new Promise((resolve) => {
    const abort = () => finishConsent('cancel');
    signal?.addEventListener('abort', abort, { once: true });
    consentResolve = (result) => { signal?.removeEventListener('abort', abort); resolve(result); };
  });
}

document.querySelector('#utterance-form')!.addEventListener('submit', (event) => {
  event.preventDefault();
  const input = document.querySelector<HTMLInputElement>('#utterance')!;
  const text = input.value.trim();
  if (!text || busy) return;
  input.value = '';
  void runUtterance(text);
});
document.addEventListener('click', (event) => {
  const target = (event.target as Element).closest<HTMLButtonElement>('button');
  if (!target || target.disabled) return;
  if (target.dataset.utterance) void runUtterance(target.dataset.utterance);
  if (target.dataset.view) { view = target.dataset.view as typeof view; render(); }
  if (target.dataset.plan) {
    const plan = plans.find((candidate) => candidate.id === target.dataset.plan);
    if (plan) void runUtterance(`Choose option ${plans.indexOf(plan) + 1}`, plan);
  }
  if (target.dataset.action === 'reset') void runUtterance('Reset demo');
  if (target.dataset.consent) finishConsent(target.dataset.consent as 'accept' | 'decline' | 'cancel');
});
document.querySelector('#reconnect')!.addEventListener('click', () => { void connect(true); });
consentDialog.addEventListener('cancel', (event) => { event.preventDefault(); finishConsent('cancel'); });
document.querySelector('#voice-toggle')!.addEventListener('click', () => {
  voiceEnabled = !voiceEnabled;
  const button = document.querySelector<HTMLButtonElement>('#voice-toggle')!;
  button.setAttribute('aria-pressed', String(voiceEnabled));
  button.setAttribute('aria-label', `Turn spoken responses ${voiceEnabled ? 'off' : 'on'}`);
  button.title = `Turn spoken responses ${voiceEnabled ? 'off' : 'on'}`;
  if (voiceEnabled) speak('Spoken responses are on.');
  else window.speechSynthesis?.cancel();
});

interface RecognitionLike {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: { results: { [index: number]: { [index: number]: { transcript: string } } } }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null; start(): void; stop(): void;
}
const speechWindow = window as unknown as { SpeechRecognition?: new () => RecognitionLike; webkitSpeechRecognition?: new () => RecognitionLike };
const Recognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
const recognition = Recognition ? new Recognition() : undefined;
if (recognition) {
  recognition.lang = 'en-US';
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.onresult = (event) => {
    const text = event.results[0][0].transcript;
    document.querySelector<HTMLInputElement>('#utterance')!.value = text;
    document.querySelector('#speech-hint')!.textContent = 'Heard you. Edit if needed, then send.';
  };
  recognition.onerror = () => { document.querySelector('#speech-hint')!.textContent = 'Microphone unavailable. Type or choose a suggestion instead.'; };
  recognition.onend = () => { document.querySelector('#microphone')!.classList.remove('listening'); };
  document.querySelector('#microphone')!.addEventListener('click', () => {
    try { recognition.start(); document.querySelector('#microphone')!.classList.add('listening'); document.querySelector('#speech-hint')!.textContent = 'Listening… Your words will appear here before sending.'; }
    catch { recognition.stop(); }
  });
} else {
  document.querySelector('#microphone')!.setAttribute('title', 'Speech input is unavailable in this browser. Use the text box.');
  document.querySelector('#speech-hint')!.textContent = 'Speech input unavailable here. Type or use a suggestion.';
}
if (!('speechSynthesis' in window)) document.querySelector<HTMLButtonElement>('#voice-toggle')!.disabled = true;
window.addEventListener('pagehide', () => { finishConsent('cancel'); void client.close({ keepalive: true }); });
renderMessages();
render();
void connect();
