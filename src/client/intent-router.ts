export type Intent =
  | { kind: 'conflicts' }
  | { kind: 'evening' }
  | { kind: 'plans' }
  | { kind: 'choose'; index: number }
  | { kind: 'agreements' }
  | { kind: 'ledger' }
  | { kind: 'change'; minutes: number }
  | { kind: 'consent'; action: 'accept' | 'decline' | 'cancel' }
  | { kind: 'reset' }
  | { kind: 'reconnect' }
  | { kind: 'unknown' };

/** This deliberately bounded router keeps the demo local, predictable, and explainable. */
export function routeIntent(utterance: string): Intent {
  const text = utterance.toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9'\s]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^(?:hey\s+)?alexa\s+/, '');
  if (/\b(reset|start over|restore|restart the demo)\b/.test(text)) return { kind: 'reset' };
  if (/\b(reconnect|connect again|server restart|restart server|server restarted)\b/.test(text)) return { kind: 'reconnect' };
  if (/^(yes|accept|agree|i agree|approve|sounds good|confirm)(\s+please)?$/.test(text)) return { kind: 'consent', action: 'accept' };
  if (/^(no|decline|reject|i disagree|do not agree|don't agree)(\s+please)?$/.test(text)) return { kind: 'consent', action: 'decline' };
  if (/^cancel(\s+please)?$/.test(text)) return { kind: 'consent', action: 'cancel' };
  if (/\b(meeting|leo)\b/.test(text) && /\b(late|long|extend|extended|longer|overrun|runs over)\b/.test(text)) {
    const number = text.match(/\b(\d+)\s*(?:minutes?|mins?)\b/);
    const minutes = number ? Number(number[1]) : 30;
    return minutes > 0 && minutes <= 120 && minutes % 15 === 0 ? { kind: 'change', minutes } : { kind: 'unknown' };
  }
  if (/\b(choose|select|pick|use|go with|take|commit)\b/.test(text) || /^(the )?(first|second|third)( one| plan| option)?$/.test(text)) {
    if (/\b(third|three|3)\b/.test(text)) return { kind: 'choose', index: 2 };
    if (/\b(second|two|2)\b/.test(text)) return { kind: 'choose', index: 1 };
    if (/\b(first|one|1)\b/.test(text)) return { kind: 'choose', index: 0 };
  }
  if (/\b(agreed|agree on|agreement|agreements|saved plan|remember|did we agree)\b/.test(text)) return { kind: 'agreements' };
  if (/\b(ledger|yielded|yielding|fairness history|fairness balance|who has moved|who's moved)\b/.test(text) || /\b(is (?:it|this|that) fair|how fair is (?:it|this|that))\b/.test(text)) return { kind: 'ledger' };
  if (/\b(tonight|evening)\b/.test(text) && /\b(living room|room|conflict|clash|plan|plans|fair|resolve|who gets)\b/.test(text)) return { kind: 'evening' };
  if (/\b(plan|plans|resolve|resolution|fair solution|fair option|fair options)\b/.test(text)) return { kind: 'plans' };
  if (/\b(clash|clashes|clashing|conflict|conflicts|overlap|overlaps|today|schedule)\b/.test(text)) return { kind: 'conflicts' };
  return { kind: 'unknown' };
}
