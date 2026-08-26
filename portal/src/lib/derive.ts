import { ACTIVITY } from "@/lib/mock/activity";
import { APPROVALS } from "@/lib/mock/approvals";
import { BASE_COMMITMENTS, CASES, PRIMARY_CASE_ID } from "@/lib/mock/cases";
import { CAPABILITY_PROOFS, POLICY_DECISIONS } from "@/lib/mock/policy";
import { DEMO_STEPS } from "@/lib/mock/steps";
import type {
  ActivityEvent,
  ApprovalRequest,
  CapabilityProof,
  CaseFlag,
  CaseSummary,
  Commitment,
  CommitmentStatus,
  PolicyDecision,
} from "@/lib/types";

type Patch = Partial<Pick<Commitment, "status" | "detail" | "lastUpdate" | "daysOverdue">> & {
  evidence?: Commitment["evidence"];
};

/** Per-step overrides applied on top of the Day 0 proposal, cumulatively. */
const COMMITMENT_PATCHES: Record<number, Record<string, Patch>> = {
  1: {
    "CM-01": { status: "pending", detail: "Reached out to Statewide Legal Aid Collective.", lastUpdate: "Day 0 · 09:31" },
    "CM-02": { status: "pending", detail: "Reached out to Riverbend Community Health.", lastUpdate: "Day 0 · 09:31" },
    "CM-03": { status: "pending", detail: "Reached out to Lincoln Unified School District.", lastUpdate: "Day 0 · 09:31" },
    "CM-04": { status: "pending", detail: "Reached out to Harborlight Youth Shelter.", lastUpdate: "Day 0 · 09:31" },
    "CM-05": { status: "pending", detail: "Reached out to Mesa County Family Services.", lastUpdate: "Day 0 · 09:31" },
  },
  2: {
    "CM-01": {
      status: "completed",
      detail: "Referral accepted. Staff attorney Anna Reed assigned. Next deadline Day 30.",
      lastUpdate: "Day 3 · 11:02",
      evidence: [
        {
          id: "EV-1201",
          label: "Referral status: active · counsel assigned",
          source: "legal@statewide-legalaid.partner · evt-2022",
          capturedAt: "Day 3 · 11:02",
          confidence: 0.98,
        },
      ],
    },
    "CM-02": {
      status: "scheduled",
      detail: "Wellness visit scheduled for Day 12 at Riverbend Community Health.",
      lastUpdate: "Day 3 · 11:02",
      evidence: [
        {
          id: "EV-1202",
          label: "Appointment status: scheduled Day 12",
          source: "health@riverbend-health.partner · evt-2023",
          capturedAt: "Day 3 · 11:02",
          confidence: 0.97,
        },
      ],
    },
    "CM-03": {
      status: "unresolved",
      detail: "District acknowledged receipt but named no responsible enrollment coordinator.",
      lastUpdate: "Day 3 · 11:03",
      daysOverdue: 3,
      evidence: [
        {
          id: "EV-1203",
          label: "No verified owner returned for referral ED-77120",
          source: "verifier@caserelay.iam · evt-2026",
          capturedAt: "Day 3 · 11:03",
          confidence: 0.92,
        },
      ],
    },
    "CM-04": {
      status: "waitlisted",
      detail: "Referral received and waitlisted. Expected response Day 12.",
      lastUpdate: "Day 3 · 11:02",
      evidence: [
        {
          id: "EV-1204",
          label: "Referral status: waitlisted · response window Day 12",
          source: "shelter@harborlight.partner · evt-2024",
          capturedAt: "Day 3 · 11:02",
          confidence: 0.94,
        },
      ],
    },
    "CM-05": {
      status: "in_progress",
      detail: "Scheduling pending. Worker not yet assigned.",
      lastUpdate: "Day 3 · 11:03",
      evidence: [
        {
          id: "EV-1205",
          label: "Assessment scheduling: pending",
          source: "family@mesa-family-services.partner · evt-2025",
          capturedAt: "Day 3 · 11:03",
          confidence: 0.9,
        },
      ],
    },
  },
  4: {
    "CM-03": {
      status: "unresolved",
      detail:
        "17 days with no named owner. CaseRelay checked back automatically and re-requested enrollment status from Lincoln Unified.",
      lastUpdate: "Day 17 · 09:00",
      daysOverdue: 17,
    },
  },
  5: {
    "CM-03": {
      status: "blocked",
      detail:
        "Lincoln Unified's response was set aside — it tried to access information outside its scope. A follow-up was sent; no enrollment coordinator has been named.",
      lastUpdate: "Day 17 · 09:00",
      daysOverdue: 17,
      evidence: [
        {
          id: "EV-1206",
          label: "Missing operational requirement: transfer packet not routed",
          source: "education@lincoln-usd.partner · evt-2054",
          capturedAt: "Day 17 · 09:00",
          confidence: 0.88,
        },
      ],
    },
  },
  6: {
    "CM-03": {
      status: "blocked",
      detail: "Escalation drafted to the district enrollment office. Waiting on supervisor approval AP-8802.",
      lastUpdate: "Day 17 · 09:04",
      daysOverdue: 17,
    },
  },
  7: {
    "CM-03": {
      status: "completed",
      detail:
        "Enrolled at Lincoln Middle School effective Day 18. Enrollment coordinator Sarah Miller is the named owner.",
      lastUpdate: "Day 18 · 14:22",
      daysOverdue: undefined,
      evidence: [
        {
          id: "EV-1207",
          label: "Callback: enrolled · enrollment coordinator Sarah Miller",
          source: "education@lincoln-usd.partner · evt-2072",
          capturedAt: "Day 18 · 14:22",
          confidence: 0.99,
        },
      ],
    },
    "CM-04": {
      status: "waitlisted",
      detail: "Referral received and waitlisted. Expected response Day 12 (response window extended).",
      lastUpdate: "Day 12 · 08:40",
    },
    "CM-05": {
      status: "scheduled",
      detail: "Assessment scheduled for Day 21. Caseworker Maria Lopez assigned.",
      lastUpdate: "Day 14 · 13:05",
      evidence: [
        {
          id: "EV-1208",
          label: "Assessment scheduled Day 21 · worker assigned",
          source: "family@mesa-family-services.partner",
          capturedAt: "Day 14 · 13:05",
          confidence: 0.95,
        },
      ],
    },
  },
};

export function deriveCommitments(step: number): Commitment[] {
  return BASE_COMMITMENTS.map((base) => {
    let next: Commitment = { ...base, evidence: [...base.evidence] };
    for (let s = 0; s <= step; s += 1) {
      const patch = COMMITMENT_PATCHES[s]?.[base.id];
      if (!patch) continue;
      const { evidence, ...rest } = patch;
      next = {
        ...next,
        ...rest,
        evidence: evidence ? [...next.evidence, ...evidence] : next.evidence,
      };
    }
    return next;
  });
}

export function deriveActivity(step: number): ActivityEvent[] {
  return ACTIVITY.filter((event) => event.step <= step);
}

export function derivePolicyDecisions(step: number): PolicyDecision[] {
  return POLICY_DECISIONS.filter((decision) => decision.step <= step);
}

export type ProvenCapability = CapabilityProof & { proven: boolean };

export function deriveCapabilityProofs(step: number): ProvenCapability[] {
  return CAPABILITY_PROOFS.map((proof) => ({
    ...proof,
    proven: proof.provenAtStep <= step,
  }));
}

export function derivePendingApprovals(
  step: number,
  decided: Record<string, "approved" | "declined">,
): ApprovalRequest[] {
  return APPROVALS.filter((approval) => {
    if (approval.availableFromStep > step) return false;
    if (decided[approval.id]) return false;
    if (approval.autoResolvedAtStep !== undefined && step >= approval.autoResolvedAtStep) return false;
    return true;
  });
}

export function deriveApprovalOutcome(
  approval: ApprovalRequest,
  step: number,
  decided: Record<string, "approved" | "declined">,
): "pending" | "approved" | "declined" | "not_yet_raised" {
  if (approval.availableFromStep > step) return "not_yet_raised";
  if (decided[approval.id]) return decided[approval.id];
  if (approval.autoResolvedAtStep !== undefined && step >= approval.autoResolvedAtStep) {
    return "approved";
  }
  return "pending";
}

/**
 * The scenario clock only drives CR-1042. Every other case is a static synthetic
 * record, so the list is rebuilt with the live case folded back into it.
 */
export function deriveCases(
  step: number,
  commitments: Commitment[],
  pendingApprovals: ApprovalRequest[],
): CaseSummary[] {
  const open = commitments.filter((item) => OPEN_STATUSES.includes(item.status));
  const education = commitments.find((item) => item.id === "CM-03");
  const overdueDays = education?.daysOverdue ?? 0;
  const needsApproval = pendingApprovals.some((item) => item.caseId === PRIMARY_CASE_ID);

  const flags: CaseFlag[] = [];
  if (step === 0) flags.push("intake_pending");
  if (overdueDays > 0) flags.push("overdue");
  if (education?.status === "blocked") flags.push("blocked");
  if (needsApproval) flags.push("approval_needed");
  if (flags.length === 0) flags.push("on_track");

  const headline =
    step === 0
      ? "Referral packet parsed into five commitments. Waiting on a supervisor authority check."
      : education?.status === "completed"
        ? "All five commitments have a verified owner. The education gap closed on Day 18."
        : overdueDays > 0
          ? `School enrollment verification has had no verified owner for ${overdueDays} days.`
          : "Five commitments dispatched to separately owned partner agents.";

  return CASES.map((item) =>
    item.id === PRIMARY_CASE_ID
      ? {
          ...item,
          flags,
          openCommitments: open.length,
          oldestGapDays: overdueDays,
          nextDeadline: overdueDays > 0 ? "Day 0 (missed)" : "Day 21",
          headline,
        }
      : item,
  );
}

export function stepMeta(step: number) {
  return DEMO_STEPS[Math.min(Math.max(step, 0), DEMO_STEPS.length - 1)];
}

export const OPEN_STATUSES: CommitmentStatus[] = [
  "proposed",
  "pending",
  "in_progress",
  "scheduled",
  "waitlisted",
  "unresolved",
  "blocked",
];
