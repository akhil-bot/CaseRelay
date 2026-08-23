import type { ApprovalRequest } from "@/lib/types";
import { EDUCATION_PROJECTION } from "@/lib/mock/policy";

export const APPROVALS: ApprovalRequest[] = [
  {
    id: "AP-8802",
    caseId: "CR-1042",
    childAlias: "Maya R.",
    createdAt: "Day 17 · 09:04:53",
    requestedBy: "orchestrator@caserelay.iam",
    action: "Send overdue-referral escalation to the district homeless-liaison office",
    recipient: "M. Okafor — McKinney-Vento Liaison, Lincoln Unified School District",
    recipientRole: "External partner organization",
    purpose: "verify_school_enrollment",
    urgency: "elevated",
    policyBasis: ["POL-ESC-007", "POL-PROJ-011", "POL-OWN-006"],
    draft: `Subject: Unresolved enrollment verification — court reference 2026-JV-0417

Our office is the court-appointed advocate for a student referred to Lincoln Unified on Day 0. The enrollment verification request has been open for 17 days with no acknowledged owner at the district.

Evidence on file:
  • Day 0  — education referral ED-77120 submitted (district intake receipt)
  • Day 17 — SIS lookup returned "unresolved", no registrar assigned
  • Day 17 — transfer packet not routed to a registrar (district-reported blocker)

Request: confirm the responsible registrar and the enrollment status for referral ED-77120.

This message discloses only the student's first name, last initial, court reference and referral ID. No health, legal, shelter or family-services information is included.`,
    evidence: [
      {
        id: "EV-2201",
        label: "District intake receipt for referral ED-77120",
        source: "partner_updates/ED-77120/receipt (Day 0 · 15:41)",
        capturedAt: "Day 0 · 15:41",
        confidence: 0.99,
      },
      {
        id: "EV-2202",
        label: "SIS enrollment lookup returned unresolved",
        source: "education@lincoln-usd.partner · evt-2054",
        capturedAt: "Day 17 · 09:00:18",
        confidence: 0.97,
      },
      {
        id: "EV-2203",
        label: "Missing operational requirement: transfer packet not routed",
        source: "education@lincoln-usd.partner · evt-2054",
        capturedAt: "Day 17 · 09:00:18",
        confidence: 0.88,
      },
      {
        id: "EV-2204",
        label: "Model Armor quarantine of the prior partner payload",
        source: "model-armor · evt-2051",
        capturedAt: "Day 17 · 09:00:09",
        confidence: 1,
      },
    ],
    projection: {
      disclosed: [
        "child.first_name",
        "child.last_initial",
        "case.court_reference",
        "referral.education_id",
        "commitment.days_overdue",
      ],
      withheld: EDUCATION_PROJECTION.withheld,
    },
    availableFromStep: 6,
    autoResolvedAtStep: 7,
  },
  {
    id: "AP-8791",
    caseId: "CR-1038",
    childAlias: "Jordan T.",
    createdAt: "Day 24 · 16:08:12",
    requestedBy: "orchestrator@caserelay.iam",
    action: "Send status reminder to assigned legal-aid counsel",
    recipient: "A. Ferrand — Statewide Legal Aid Collective",
    recipientRole: "External partner organization",
    purpose: "confirm_legal_referral_status",
    urgency: "standard",
    policyBasis: ["POL-ESC-007", "POL-PROJ-011"],
    draft: `Subject: Status confirmation — court reference 2026-JV-0388

The legal representation referral for this case shows "active" with no update in 11 days and a Day 26 filing deadline on file.

Request: confirm whether the Day 26 deadline is still accurate and whether any operational item is outstanding on our side.

No clinical, educational or family-assessment information is included in this message.`,
    evidence: [
      {
        id: "EV-2301",
        label: "Legal referral marked active with no update in 11 days",
        source: "legal@statewide-legalaid.partner · evt-1908",
        capturedAt: "Day 13 · 10:02",
        confidence: 0.95,
      },
      {
        id: "EV-2302",
        label: "Day 26 filing deadline recorded",
        source: "partner_updates/LG-4410 (Day 13 · 10:02)",
        capturedAt: "Day 13 · 10:02",
        confidence: 0.99,
      },
    ],
    projection: {
      disclosed: ["child.first_name", "child.last_initial", "case.court_reference", "referral.legal_id"],
      withheld: [
        {
          field: "health.appointment_status",
          reason: "Outside the legal agent's declared data scope.",
          ruleId: "POL-PROJ-011",
        },
        {
          field: "education.enrollment_status",
          reason: "Not required to confirm a legal referral status.",
          ruleId: "POL-PROJ-011",
        },
        {
          field: "family.assessment_findings",
          reason: "Assessment findings are never disclosed to any partner.",
          ruleId: "POL-PROJ-011",
        },
      ],
    },
    availableFromStep: 0,
  },
];
