import type { IconName } from "@/components/icons";
import type { Persona } from "@/design/personas";

/**
 * All persona-dependent wording lives here, next to the design tokens, so the two
 * products stay coherent. The advocate voice avoids trace IDs, rule numbers, span
 * timings, and service identities entirely; the platform voice leads with them.
 */

interface PageHeading {
  title: string;
  subtitle: string;
}

interface PersonaCopy {
  pages: {
    overview: PageHeading;
    cases: PageHeading;
    caseDetail: PageHeading;
    approvals: PageHeading;
    registry: PageHeading;
    audit: PageHeading;
  };
  overview: {
    attention: PageHeading;
    activity: PageHeading;
    commitments: PageHeading;
    stats: { owner: string; waiting: string; open: string; steps: string };
    statNotes: { owner: string; waiting: string; open: string; steps: string };
    attentionEmpty: { title: string; hint: string };
    footnote: string;
  };
  cases: {
    listing: PageHeading;
    searchPlaceholder: string;
    filterAll: string;
    empty: { title: string; hint: string };
    footnote: string;
    columns: { commitments: string; deadline: string; third: string; fourth: string };
  };
  caseDetail: {
    commitments: PageHeading;
    permitted: PageHeading;
    excluded: PageHeading;
    projection: PageHeading;
    disclosedLabel: string;
    withheldLabel: string;
    projectionNote: string;
    handoff: PageHeading;
    evidenceLabel: string;
  };
  approvals: {
    queue: PageHeading;
    empty: (advanced: boolean) => { title: string; hint: string };
    context: PageHeading;
    history: PageHeading;
    rules: PageHeading;
    disclosedLabel: string;
    withheldLabel: string;
    approveLabel: string;
    declineLabel: string;
    actingAs: string;
    footnote: string;
  };
  sidebar: {
    sectionLabel: string;
    limitsLabel: string;
    limits: string[];
    footerNote: string;
  };
  signIn: {
    /**
     * The panel beside the form carries one claim, not a feature list. Where the
     * headline names something that must not happen, `emphasis` is that substring
     * — it is drawn fading out, so the sentence demonstrates itself.
     */
    panel: { headline: string; emphasis?: string; body: string };
    title: string;
    subtitle: string;
    submitLabel: string;
    pendingLabel: string;
    /** The second way in — a magic link for one persona, SSO for the other. */
    alt: { label: string; icon: IconName };
    dividerLabel: string;
  };
}

const advocate: PersonaCopy = {
  pages: {
    overview: {
      title: "Today",
      subtitle: "What needs you, and what moved forward on its own.",
    },
    cases: {
      title: "My cases",
      subtitle: "Every child you advocate for, and whether their next step has an owner.",
    },
    caseDetail: {
      title: "Case",
      subtitle: "Who promised what, when it is due, and what proves it.",
    },
    approvals: {
      title: "Needs my approval",
      subtitle: "Nothing is sent to another organization until you have read it and said yes.",
    },
    registry: { title: "Not in this view", subtitle: "" },
    audit: { title: "Not in this view", subtitle: "" },
  },
  overview: {
    attention: {
      title: "Needs your attention",
      subtitle: "Nobody has taken responsibility for these steps yet.",
    },
    activity: {
      title: "Moved forward without you asking",
      subtitle: "CaseRelay kept checking while you were away.",
    },
    commitments: {
      title: "Maya's next steps",
      subtitle: "The five things her court order asks someone to do.",
    },
    stats: {
      owner: "Steps with no owner",
      waiting: "Waiting on you",
      open: "Steps still open",
      steps: "Checks done for you",
    },
    statNotes: {
      owner: "Nobody has claimed these",
      waiting: "Messages you have not approved",
      open: "Across Maya's case",
      steps: "Since the case opened",
    },
    attentionEmpty: {
      title: "Nothing is overdue right now.",
      hint: "Every step has someone responsible and a date that has not passed.",
    },
    footnote:
      "Every child, family, school, and court order here is made up for a demonstration. CaseRelay is not connected to any real case system and is not endorsed by National CASA/GAL.",
  },
  cases: {
    listing: {
      title: "Your caseload",
      subtitle: "Six children. The one marked live is the case in this walkthrough.",
    },
    searchPlaceholder: "Search by child, case number, or county",
    filterAll: "All my cases",
    empty: { title: "No case matches that search.", hint: "Try a different name or case number." },
    footnote:
      "CaseRelay keeps track of whether someone has taken responsibility for a step. It never decides where a child lives, what care they receive, or how their case should be argued.",
    columns: {
      commitments: "Steps done",
      deadline: "Next due date",
      third: "Court order",
      fourth: "Your supervisor",
    },
  },
  caseDetail: {
    commitments: {
      title: "Next steps",
      subtitle: "Each step belongs to one organization. CaseRelay chases the ones nobody claimed.",
    },
    permitted: {
      title: "What you are allowed to do",
      subtitle: "Set by the court order your supervisor verified.",
    },
    excluded: {
      title: "What nobody here decides",
      subtitle: "These belong to the court and the professionals involved.",
    },
    projection: {
      title: "What the school was told",
      subtitle: "The school needed to answer one question, so it was given only what that question needs.",
    },
    disclosedLabel: "Shared with the school",
    withheldLabel: "Never left CaseRelay",
    projectionNote:
      "Her health, legal, shelter, and family-services information was not filtered out of a shared file — no shared file about Maya is ever put together in the first place.",
    handoff: {
      title: "If this case moves to another volunteer",
      subtitle: "The work carries over. The old volunteer's access does not.",
    },
    evidenceLabel: "Proof",
  },
  approvals: {
    queue: {
      title: "Waiting for your yes",
      subtitle: "Read the message, check exactly what it shares, then decide.",
    },
    empty: (advanced) => ({
      title: "Nothing is waiting on you.",
      hint: advanced
        ? "The overdue school message was approved and sent."
        : "When CaseRelay wants to contact another organization, it will ask you here first.",
    }),
    context: {
      title: "Why this message is needed",
      subtitle: "The school's last reply asked for information it is not allowed to have.",
    },
    history: { title: "What you have already decided", subtitle: "" },
    rules: {
      title: "Promises CaseRelay keeps",
      subtitle: "These are fixed rules, not judgement calls the software makes each time.",
    },
    disclosedLabel: "This message will share",
    withheldLabel: "This message will not share",
    approveLabel: "Approve and send",
    declineLabel: "Do not send",
    actingAs: "You are approving as",
    footnote:
      "CaseRelay can draft wording and read documents. It cannot choose who to contact, what to share, or when to send — those are fixed rules and your decision.",
  },
  sidebar: {
    sectionLabel: "My work",
    limitsLabel: "What CaseRelay will never do",
    limits: [
      "Decide where a child lives",
      "Give legal or medical advice",
      "Contact anyone without your approval",
    ],
    footerNote: "No real child, family, or school record is used anywhere in this demonstration.",
  },
  signIn: {
    panel: {
      headline: "A promise made for a child should never quietly go missing.",
      emphasis: "quietly go missing",
      body: "You showed up for a child. CaseRelay makes sure everyone else who promised something shows up too.",
    },
    title: "Sign in to your cases",
    subtitle: "Use the email your CASA program has on file.",
    submitLabel: "Sign in",
    pendingLabel: "Signing you in…",
    alt: { label: "Email me a sign-in link", icon: "mail" },
    dividerLabel: "or",
  },
};

const platform: PersonaCopy = {
  pages: {
    overview: {
      title: "Fleet health",
      subtitle: "Runtime state, refusals, and which governed capabilities are proven.",
    },
    cases: {
      title: "Workflows",
      subtitle: "Durable executions by case reference, with commitment state and owning agents.",
    },
    caseDetail: {
      title: "Workflow detail",
      subtitle: "Commitment state machine, owning identities, evidence provenance, and projections.",
    },
    approvals: {
      title: "Policy queue",
      subtitle: "Actions held by POL-ESC-007 pending a human principal, with full field projections.",
    },
    registry: {
      title: "Agent registry",
      subtitle: "Versioned cards, owning organizations, declared scopes, and denied scopes.",
    },
    audit: {
      title: "Traces & audit",
      subtitle: "One correlated trace across discovery, runtime, gateway, armor, policy, and completion.",
    },
  },
  overview: {
    attention: {
      title: "Workflows breaching SLA",
      subtitle: "Commitments with no acknowledged owner at the partner organization.",
    },
    activity: {
      title: "Recent spans",
      subtitle: "Newest first, with actor and elapsed time.",
    },
    commitments: {
      title: "Commitment state · CR-1042",
      subtitle: "State machine for the workflow the scenario clock is driving.",
    },
    stats: {
      owner: "Unowned commitments",
      waiting: "Held for human principal",
      open: "Non-terminal states",
      steps: "Spans in trace",
    },
    statNotes: {
      owner: "POL-OWN-006 breaches",
      waiting: "POL-ESC-007 gate",
      open: "Excluding completed",
      steps: "Single correlated trace",
    },
    attentionEmpty: {
      title: "No SLA breaches at this step.",
      hint: "Every commitment has an acknowledged owner and an in-window deadline.",
    },
    footnote:
      "Synthetic fixtures only. No agent is deployed behind this build, no request leaves the browser, and health and latency figures are illustrative.",
  },
  cases: {
    listing: {
      title: "Durable executions",
      subtitle: "Six workflows. CR-1042 is bound to the scenario clock.",
    },
    searchPlaceholder: "Search by case reference, workflow, or county",
    filterAll: "All workflows",
    empty: { title: "No workflow matches that query.", hint: "Try a case reference or filter." },
    footnote:
      "Deterministic code owns authorization, field projection, deadline thresholds, retries, state transitions, approval requirements, and idempotency. The model only extracts, classifies, and drafts.",
    columns: {
      commitments: "Terminal states",
      deadline: "Next deadline",
      third: "Authority ref",
      fourth: "Approving principal",
    },
  },
  caseDetail: {
    commitments: {
      title: "Commitments",
      subtitle: "One owning organization per commitment, each with a distinct identity and data scope.",
    },
    permitted: {
      title: "Granted scopes",
      subtitle: "Purposes carried in the request envelope.",
    },
    excluded: {
      title: "Denied scopes",
      subtitle: "Rejected at the gateway regardless of caller.",
    },
    projection: {
      title: "Gateway projection · verify_school_enrollment",
      subtitle: "Minimum-necessary field set computed from the education agent's registry card.",
    },
    disclosedLabel: "Disclosed",
    withheldLabel: "Withheld",
    projectionNote:
      "The Orchestrator never held the withheld fields either. Cross-domain records are unreachable by construction, not removed by a filter.",
    handoff: {
      title: "Principal rotation",
      subtitle: "Operational state persists; the outgoing principal's credentials are revoked.",
    },
    evidenceLabel: "Evidence",
  },
  approvals: {
    queue: {
      title: "Held for human approval",
      subtitle: "Recipient, purpose, disclosed set, withheld set, and applied rule IDs.",
    },
    empty: (advanced) => ({
      title: "No action is held at this step.",
      hint: advanced
        ? "AP-8802 was approved; the digest is bound to the disclosed field set."
        : "Advance the scenario clock to Day 17 to raise the POL-ESC-007 gate.",
    }),
    context: {
      title: "Upstream refusal",
      subtitle: "The partner payload was quarantined before it entered any agent context.",
    },
    history: { title: "Decision log", subtitle: "Bound to the exact disclosed field set." },
    rules: {
      title: "Policy rules in force",
      subtitle: "Deterministic evaluation order, applied before any outbound effect.",
    },
    disclosedLabel: "Disclosed set",
    withheldLabel: "Withheld set",
    approveLabel: "Approve and dispatch",
    declineLabel: "Deny",
    actingAs: "Acting as human principal",
    footnote:
      "Agents return evidence, applied rule IDs, and human-readable explanations — never private chain-of-thought.",
  },
  sidebar: {
    sectionLabel: "Platform",
    limitsLabel: "Enforced invariants",
    limits: [
      "No cross-domain field projection",
      "No self-approved outbound action",
      "Exactly-once business effect",
    ],
    footerNote: "Synthetic fixtures. Nothing in this build is deployed and no request leaves the browser.",
  },
  signIn: {
    panel: {
      headline: "A control plane for care.",
      body: "Registry, runtime, identity, gateway, and policy — one correlated trace.",
    },
    title: "Fleet console sign-in",
    subtitle: "Authenticate against your workforce identity provider.",
    submitLabel: "Sign in",
    pendingLabel: "Verifying…",
    alt: { label: "Continue with single sign-on", icon: "identity" },
    dividerLabel: "or use a directory account",
  },
};

export const COPY: Record<Persona, PersonaCopy> = { advocate, platform };

/**
 * Field paths are how the platform view names data. The advocate view names the
 * same things the way a person would say them out loud.
 */
const FIELD_LABELS: Record<string, string> = {
  "child.first_name": "Her first name",
  "child.last_initial": "The initial of her last name",
  "child.date_of_birth": "Her date of birth",
  "child.full_legal_name": "Her full legal name",
  "child.home_address": "Where she lives",
  "case.court_reference": "The court order number",
  "referral.education_id": "The school referral number",
  "referral.legal_id": "The legal referral number",
  "commitment.days_overdue": "How long this has been waiting",
  "health.immunization_records": "Her immunisation records",
  "health.appointment_notes": "Notes from her medical visit",
  "health.appointment_status": "Whether she has a medical appointment",
  "legal.assigned_counsel": "Who her lawyer is",
  "legal.hearing_summary": "What happened at her hearing",
  "family.assessment_findings": "What the family assessment found",
  "shelter.placement_history": "Where she has stayed before",
  "education.enrollment_status": "Whether she is enrolled at school",
};

export function fieldLabel(field: string, technical: boolean) {
  if (technical) return field;
  return FIELD_LABELS[field] ?? field.split(".").pop()?.replace(/_/g, " ") ?? field;
}
