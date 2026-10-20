// All members share one consent budget, leaving time for the tool response.
export const CONSENT_TIMEOUT_MS = 120_000;
export const TOOL_CALL_TIMEOUT_MS = CONSENT_TIMEOUT_MS + 60_000;
