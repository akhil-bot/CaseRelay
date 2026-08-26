import type { DemoStep } from "@/lib/types";

/**
 * The eight demo steps mirror the 3:50 demo script. Every screen derives what it
 * shows from the active step index, so advancing the demo moves the whole portal.
 */
export const DEMO_STEPS: DemoStep[] = [
  {
    index: 0,
    id: "intake",
    label: "Intake review",
    dayLabel: "Day 0",
    narration:
      "CaseRelay read the Nguyen family's referral packet and identified five steps needed for Maya's case. Nothing starts until Dana Whitfield confirms the court order.",
    caseState: "intake_review",
  },
  {
    index: 1,
    id: "activated",
    label: "Court order confirmed",
    dayLabel: "Day 0",
    narration:
      "Dana Whitfield verified the court order and activated the case. CaseRelay reached out to five service providers, each with their own contact and scope.",
    caseState: "monitoring",
  },
  {
    index: 2,
    id: "delegated",
    label: "Service providers respond",
    dayLabel: "Day 3",
    narration:
      "Statewide Legal Aid Collective accepted the referral. Riverbend Community Health has the wellness visit scheduled. Harborlight and family services are pending. Lincoln Unified has no named contact for Maya's enrollment.",
    caseState: "monitoring",
  },
  {
    index: 3,
    id: "asleep",
    label: "Case paused",
    dayLabel: "Day 4",
    narration:
      "CaseRelay saved the case and paused. No app needs to stay open — it will check back automatically on day 17 when the follow-up date arrives.",
    caseState: "monitoring_asleep",
  },
  {
    index: 4,
    id: "wake",
    label: "Automatic follow-up",
    dayLabel: "Day 17",
    narration:
      "On day 17, CaseRelay checked back automatically — no one had to remember. It contacted Lincoln Unified with only the fields needed to verify Maya's enrollment.",
    caseState: "attention_required",
  },
  {
    index: 5,
    id: "quarantine",
    label: "Unsafe response refused",
    dayLabel: "Day 17",
    narration:
      "Lincoln Unified's response tried to access Maya's medical records. CaseRelay blocked that request and followed up with only the information the school is allowed to see.",
    caseState: "attention_required",
  },
  {
    index: 6,
    id: "approval",
    label: "Escalation awaiting approval",
    dayLabel: "Day 17",
    narration:
      "CaseRelay drafted a follow-up to Lincoln Unified's enrollment office. Dana Whitfield sees the full message, exactly what it shares, and must approve before anything is sent.",
    caseState: "approval_required",
  },
  {
    index: 7,
    id: "resolved",
    label: "Enrollment confirmed",
    dayLabel: "Day 18",
    narration:
      "Lincoln Unified confirmed Maya's enrollment. CaseRelay recorded it, closed the step, and automatically blocked a duplicate confirmation.",
    caseState: "monitoring",
  },
];

export const LAST_STEP = DEMO_STEPS.length - 1;
