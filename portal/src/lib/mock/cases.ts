import type { CaseSummary, Commitment } from "@/lib/types";

export const PRIMARY_CASE_ID = "CR-1042";
export const WORKFLOW_ID = "wf-school-enrollment";

export const CASES: CaseSummary[] = [
  {
    id: "CR-1042",
    childAlias: "Maya R.",
    volunteer: "Elena Vasquez",
    supervisor: "Dana Whitfield",
    county: "Mesa County",
    openedOn: "Day 0",
    courtOrder: "Order 2026-JV-0417",
    flags: ["overdue", "approval_needed"],
    state: "attention_required",
    commitmentCount: 5,
    openCommitments: 3,
    oldestGapDays: 17,
    nextDeadline: "Day 0 (missed)",
    headline: "School enrollment verification has had no verified owner for 17 days.",
  },
  {
    id: "CR-1038",
    childAlias: "Jordan T.",
    volunteer: "Elena Vasquez",
    supervisor: "Dana Whitfield",
    county: "Mesa County",
    openedOn: "Day -22",
    courtOrder: "Order 2026-JV-0388",
    flags: ["approval_needed"],
    state: "approval_required",
    commitmentCount: 4,
    openCommitments: 1,
    oldestGapDays: 4,
    nextDeadline: "Day 26",
    headline: "Draft escalation to legal aid is waiting on supervisor approval.",
  },
  {
    id: "CR-1051",
    childAlias: "Amara O.",
    volunteer: "Elena Vasquez",
    supervisor: "Dana Whitfield",
    county: "Mesa County",
    openedOn: "Day -6",
    courtOrder: "Order 2026-JV-0451",
    flags: ["blocked", "approval_needed"],
    state: "attention_required",
    commitmentCount: 3,
    openCommitments: 2,
    oldestGapDays: 6,
    nextDeadline: "Day 9",
    headline: "Shelter partner agent timed out three times; task moved to dead-letter review.",
  },
  {
    id: "CR-1047",
    childAlias: "Priya N.",
    volunteer: "Elena Vasquez",
    supervisor: "Dana Whitfield",
    county: "Mesa County",
    openedOn: "Day -11",
    courtOrder: "Order 2026-JV-0429",
    flags: ["on_track", "approval_needed"],
    state: "approval_required",
    commitmentCount: 4,
    openCommitments: 2,
    oldestGapDays: 1,
    nextDeadline: "Day 19",
    headline:
      "Every commitment has a verified owner. One appointment needs its outcome confirmed.",
  },
  {
    id: "CR-1029",
    childAlias: "Diego S.",
    volunteer: "Elena Vasquez",
    supervisor: "Dana Whitfield",
    county: "Mesa County",
    openedOn: "Day -48",
    courtOrder: "Order 2026-JV-0311",
    flags: ["recently_completed"],
    state: "closed",
    commitmentCount: 5,
    openCommitments: 0,
    oldestGapDays: 0,
    nextDeadline: "—",
    headline: "Case closed on Day 44. Monitoring disabled and 7-year retention applied.",
  },
  {
    id: "CR-1055",
    childAlias: "Noah B.",
    volunteer: "Elena Vasquez",
    supervisor: "Dana Whitfield",
    county: "Mesa County",
    openedOn: "Day -1",
    courtOrder: "Order 2026-JV-0460",
    flags: ["intake_pending"],
    state: "intake_review",
    commitmentCount: 4,
    openCommitments: 4,
    oldestGapDays: 0,
    nextDeadline: "Awaiting activation",
    headline: "Referral packet parsed. Supervisor has not yet verified court authority.",
  },
];

export const CASES_BY_ID: Record<string, CaseSummary> = Object.fromEntries(
  CASES.map((item) => [item.id, item]),
);

/**
 * Baseline commitments for CR-1042. The demo store rewrites status/detail per step;
 * this array is the Day 0 proposal produced by the Intake & Authority Agent.
 */
export const BASE_COMMITMENTS: Commitment[] = [
  {
    id: "CM-01",
    domain: "legal",
    title: "Confirm legal representation referral accepted",
    ownerOrg: "Statewide Legal Aid Collective",
    ownerAgentId: "legal-aid",
    dueDay: 10,
    status: "proposed",
    detail: "Extracted from referral packet page 3. Awaiting supervisor activation.",
    lastUpdate: "Day 0 · 09:14",
    evidence: [
      {
        id: "EV-1101",
        label: "Referral packet §3 — legal representation request",
        source: "gs://caserelay-synthetic/CR-1042/packet.pdf#p3",
        capturedAt: "Day 0 · 09:12",
        confidence: 0.96,
      },
    ],
  },
  {
    id: "CM-02",
    domain: "healthcare",
    title: "Confirm pediatric wellness visit scheduled",
    ownerOrg: "Riverbend Community Health",
    ownerAgentId: "health-coordination",
    dueDay: 14,
    status: "proposed",
    detail: "Extracted from referral packet page 5. Appointment status only.",
    lastUpdate: "Day 0 · 09:14",
    evidence: [
      {
        id: "EV-1102",
        label: "Referral packet §5 — wellness visit requirement",
        source: "gs://caserelay-synthetic/CR-1042/packet.pdf#p5",
        capturedAt: "Day 0 · 09:12",
        confidence: 0.94,
      },
    ],
  },
  {
    id: "CM-03",
    domain: "education",
    title: "Verify school enrollment and named school contact",
    ownerOrg: "Lincoln Unified School District",
    ownerAgentId: "education-liaison",
    dueDay: 0,
    status: "proposed",
    detail: "Extracted from referral packet page 2. No verified owner assigned yet.",
    lastUpdate: "Day 0 · 09:14",
    evidence: [
      {
        id: "EV-1103",
        label: "Referral packet §2 — school transfer pending",
        source: "gs://caserelay-synthetic/CR-1042/packet.pdf#p2",
        capturedAt: "Day 0 · 09:12",
        confidence: 0.91,
      },
    ],
  },
  {
    id: "CM-04",
    domain: "shelter",
    title: "Confirm shelter referral received and response window",
    ownerOrg: "Harborlight Youth Shelter",
    ownerAgentId: "shelter-status",
    dueDay: 12,
    status: "proposed",
    detail: "Extracted from referral packet page 6. Status tracking only, no placement input.",
    lastUpdate: "Day 0 · 09:14",
    evidence: [
      {
        id: "EV-1104",
        label: "Referral packet §6 — interim housing referral",
        source: "gs://caserelay-synthetic/CR-1042/packet.pdf#p6",
        capturedAt: "Day 0 · 09:12",
        confidence: 0.89,
      },
    ],
  },
  {
    id: "CM-05",
    domain: "family",
    title: "Confirm family assessment appointment scheduled",
    ownerOrg: "Mesa County Family Services",
    ownerAgentId: "family-services",
    dueDay: 21,
    status: "proposed",
    detail: "Extracted from referral packet page 7. Scheduling status only, no findings.",
    lastUpdate: "Day 0 · 09:14",
    evidence: [
      {
        id: "EV-1105",
        label: "Referral packet §7 — family assessment order",
        source: "gs://caserelay-synthetic/CR-1042/packet.pdf#p7",
        capturedAt: "Day 0 · 09:12",
        confidence: 0.93,
      },
    ],
  },
];

export const AUTHORITY_GRANT = {
  id: "AG-4417",
  courtOrder: "Order 2026-JV-0417",
  appointedAdvocate: "Elena Vasquez",
  verifiedBy: "Dana Whitfield (Advocate Supervisor)",
  scope: [
    "monitor_commitment_status",
    "request_enrollment_verification",
    "draft_escalation_for_human_approval",
  ],
  excluded: [
    "placement_decision",
    "clinical_decision",
    "legal_strategy",
    "eligibility_determination",
  ],
  expiresOn: "Day 180",
  retention: "Operational facts 7 years · raw packet 90 days",
};

/**
 * The grant read out loud, for anyone who is not reading scope identifiers.
 * Same list either way — an advocate and the runtime are held to one grant, not
 * to a plain-language summary of it and a machine-readable version that drifts.
 */
export const PLAIN_SCOPES: Record<string, string> = {
  monitor_commitment_status: "Keep track of whether each step is done",
  request_enrollment_verification: "Ask the school to confirm she is enrolled",
  draft_escalation_for_human_approval: "Write a follow-up message for you to approve",
  placement_decision: "Decide where she lives",
  clinical_decision: "Decide what medical care she gets",
  legal_strategy: "Decide how her case is argued",
  eligibility_determination: "Decide what services she qualifies for",
};
