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
      "The Intake & Authority Agent extracted five operational commitments from a synthetic referral packet. Nothing is active until a supervisor verifies court authority.",
    caseState: "intake_review",
  },
  {
    index: 1,
    id: "activated",
    label: "Authority verified",
    dayLabel: "Day 0",
    narration:
      "The supervisor verified Order 2026-JV-0417 and activated monitoring. The Orchestrator resolved five separately owned partner agents through the registry.",
    caseState: "monitoring",
  },
  {
    index: 2,
    id: "delegated",
    label: "Partners respond",
    dayLabel: "Day 3",
    narration:
      "Legal reports the referral accepted. Health reports the visit scheduled. Shelter and family services report pending. Education has no verified owner.",
    caseState: "monitoring",
  },
  {
    index: 3,
    id: "asleep",
    label: "Workflow checkpointed",
    dayLabel: "Day 4",
    narration:
      "The workflow wrote a durable checkpoint to memory and went to sleep. No chat session stays open and no browser has to stay connected.",
    caseState: "monitoring_asleep",
  },
  {
    index: 4,
    id: "wake",
    label: "Day 17 wake",
    dayLabel: "Day 17",
    narration:
      "A scheduled deadline event resumed the same workflow with nobody prompting it. The Gateway projected only the fields needed to verify enrollment.",
    caseState: "attention_required",
  },
  {
    index: 5,
    id: "quarantine",
    label: "Unsafe response refused",
    dayLabel: "Day 17",
    narration:
      "The school payload carried an instruction to retrieve medical notes. Model Armor quarantined it and the Verifier issued a policy-compliant retry.",
    caseState: "attention_required",
  },
  {
    index: 6,
    id: "approval",
    label: "Escalation awaiting human",
    dayLabel: "Day 17",
    narration:
      "CaseRelay drafted an evidence-backed escalation. The supervisor sees recipient, purpose, disclosed fields, withheld fields, and policy basis before approving.",
    caseState: "approval_required",
  },
  {
    index: 7,
    id: "resolved",
    label: "Callback closes the gap",
    dayLabel: "Day 18",
    narration:
      "The school confirmed enrollment. The callback resumed the same workflow idempotently, closed the commitment, and a duplicate callback changed nothing.",
    caseState: "monitoring",
  },
];

export const LAST_STEP = DEMO_STEPS.length - 1;
