export type MemberId = string;
export interface Member { id: MemberId; name: string; description: string }
export interface Resource { id: string; name: string; shared: boolean }
export interface Activity {
  id: string; memberId: MemberId; title: string; date: string;
  start: number; end: number; resourceId: string; loud: boolean;
  needsQuiet: boolean; fixed: boolean; mode?: string;
  protectedNeed?: string;
  flexibleWindow?: { start: number; end: number };
  minDuration?: number;
  quietAlternative?: { mode: string; loud: boolean };
  alternativeResourceIds?: string[];
}
export interface LedgerEntry {
  memberId: MemberId; yieldCount: number; requiredYields: number;
  negotiatedYields: number; effortPoints: number;
}
export interface PlanChange {
  activityId: string; memberId: MemberId; before: Activity; after: Activity;
  description: string; effortPoints: number; yieldType: 'required' | 'negotiated';
}
export interface Conflict {
  id: string; date: string; activityIds: string[]; title: string;
  description: string; start: number; end: number;
}
export interface Plan {
  id: string; revision: number; conflictId: string; title: string; reason: string;
  changes: PlanChange[]; yieldingMemberIds: MemberId[];
  ledgerImpact: LedgerEntry[]; score: number;
  disruptionScore: number; recommended: boolean; badges: string[];
  affectedAgreementIds: string[];
}
export interface Agreement {
  id: string; planId: string; title: string; changes: PlanChange[];
  acceptedBy: MemberId[]; createdAt: string; status: 'active' | 'superseded';
}
export interface HouseholdState {
  schemaVersion: 2; revision: number; date: string; fictional: true;
  members: Member[]; resources: Resource[]; activities: Activity[];
  ledger: LedgerEntry[]; agreements: Agreement[];
}
export interface ToolData {
  kind: 'state' | 'conflicts' | 'plans' | 'commit' | 'change' | 'ledger' | 'reset';
  message: string; state?: HouseholdState; conflicts?: Conflict[];
  plans?: Plan[]; ledger?: LedgerEntry[]; agreement?: Agreement;
  committed?: boolean; affectedAgreementIds?: string[];
  keptAgreementIds?: string[];
}
export interface ConsentForm {
  memberId: MemberId; memberName: string; planId: string; changes: PlanChange[];
}
