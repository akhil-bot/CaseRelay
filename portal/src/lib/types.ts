export type Domain =
  | "legal"
  | "education"
  | "health"
  | "shelter"
  | "family_services";

export type CommitmentStatus =
  | "proposed"
  | "pending"
  | "in_progress"
  | "scheduled"
  | "waitlisted"
  | "unresolved"
  | "deferred"
  | "blocked"
  | "completed";

export type CaseState =
  | "intake_review"
  | "monitoring"
  | "monitoring_asleep"
  | "attention_required"
  | "approval_required"
  | "closed";

export type CaseFlag =
  | "overdue"
  | "blocked"
  | "on_track"
  | "recently_completed"
  | "intake_pending";

export type Health = "healthy" | "degraded" | "unverified";

export type PolicyOutcome =
  | "allow"
  | "deny"
  | "quarantine"
  | "requires_human_approval";

export type CapabilityKey =
  | "registry"
  | "runtime"
  | "memory"
  | "identity"
  | "gateway"
  | "model_armor"
  | "observability";

export interface EvidenceRef {
  id: string;
  label: string;
  source: string;
  capturedAt: string;
  confidence: number;
}

export interface Commitment {
  id: string;
  domain: Domain;
  title: string;
  ownerOrg: string;
  ownerAgentId: string;
  dueDay: number;
  status: CommitmentStatus;
  detail: string;
  lastUpdate: string;
  daysOverdue?: number;
  evidence: EvidenceRef[];
}

export interface CaseSummary {
  id: string;
  childAlias: string;
  volunteer: string;
  supervisor: string;
  county: string;
  openedOn: string;
  courtOrder: string;
  flags: CaseFlag[];
  state: CaseState;
  commitmentCount: number;
  openCommitments: number;
  oldestGapDays: number;
  nextDeadline: string;
  headline: string;
}

export type ActivityKind =
  | "registry"
  | "runtime"
  | "memory"
  | "identity"
  | "gateway"
  | "model"
  | "tool"
  | "policy"
  | "armor"
  | "approval"
  | "retry"
  | "callback"
  | "audit";

export interface ActivityEvent {
  id: string;
  step: number;
  at: string;
  dayOffset: number;
  kind: ActivityKind;
  actor: string;
  summary: string;
  detail: string;
  spanMs: number;
  outcome?: PolicyOutcome;
  idempotencyKey?: string;
  capability?: CapabilityKey;
}

export interface FieldProjection {
  disclosed: string[];
  withheld: { field: string; reason: string; ruleId: string }[];
}

export interface DemoStep {
  index: number;
  id: string;
  label: string;
  dayLabel: string;
  narration: string;
  caseState: CaseState;
}
