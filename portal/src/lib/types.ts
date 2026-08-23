export type Domain =
  | "legal"
  | "education"
  | "healthcare"
  | "shelter"
  | "family";

export type CommitmentStatus =
  | "proposed"
  | "pending"
  | "in_progress"
  | "scheduled"
  | "waitlisted"
  | "unresolved"
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
  | "approval_needed"
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

export interface AgentCard {
  id: string;
  name: string;
  owner: string;
  ownerKind: "casa" | "partner" | "compliance";
  identity: string;
  version: string;
  purpose: string;
  tools: string[];
  dataScopes: string[];
  deniedScopes: string[];
  endpoint: string;
  health: Health;
  p50Ms: number;
  lastHeartbeat: string;
  registeredOn: string;
  domain?: Domain;
}

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

export interface PolicyDecision {
  id: string;
  step: number;
  at: string;
  outcome: PolicyOutcome;
  subject: string;
  ruleIds: string[];
  explanation: string;
  projection?: FieldProjection;
  retryInstruction?: string;
}

export interface ApprovalRequest {
  id: string;
  caseId: string;
  childAlias: string;
  createdAt: string;
  requestedBy: string;
  action: string;
  recipient: string;
  recipientRole: string;
  purpose: string;
  urgency: "standard" | "elevated";
  policyBasis: string[];
  draft: string;
  evidence: EvidenceRef[];
  projection: FieldProjection;
  availableFromStep: number;
  autoResolvedAtStep?: number;
}

export interface CapabilityProof {
  key: CapabilityKey;
  label: string;
  managedProduct: string;
  status: "callable" | "proof_only" | "fallback";
  evidence: string;
  provenAtStep: number;
}

export interface DemoStep {
  index: number;
  id: string;
  label: string;
  dayLabel: string;
  narration: string;
  caseState: CaseState;
}
