import type { IconName } from "@/components/icons";
import type { Persona } from "@/design/personas";
import { PRIMARY_CASE_ID } from "@/lib/mock/cases";

/**
 * All persona-dependent wording lives here, next to the design tokens, so the two
 * products stay coherent. The advocate voice avoids trace IDs, rule numbers, span
 * timings, and service identities entirely; the platform voice leads with them.
 */

interface PageHeading {
  title: string;
  subtitle: string;
}

/** A heading with the list it introduces, where the list is copy rather than data. */
interface Section<T> extends PageHeading {
  items: T[];
}

/**
 * One task walkthrough. The steps are the order a person actually does them in,
 * so they are a list rather than a paragraph.
 */
interface HowTo {
  title: string;
  icon: IconName;
  /** The screen the walkthrough is about, where there is one to open. */
  href?: string;
  steps: string[];
}

/**
 * A standing limit on what the product does. Stated as the claim first and the
 * detail second, so the page can be skimmed down the titles alone.
 */
interface Limit {
  title: string;
  body: string;
  icon: IconName;
}

interface PersonaCopy {
  pages: {
    overview: PageHeading;
    cases: PageHeading;
    caseDetail: PageHeading;
    approvals: PageHeading;
    approvalDetail: PageHeading;
    registry: PageHeading;
    audit: PageHeading;
    admin: PageHeading;
    guidelines: PageHeading;
  };
  overview: {
    attention: PageHeading;
    activity: PageHeading;
    commitments: PageHeading;
    stats: { owner: string; waiting: string; open: string; steps: string };
    statNotes: { owner: string; waiting: string; open: string; steps: string };
    attentionEmpty: { title: string; hint: string };
  };
  cases: {
    listing: PageHeading;
    searchPlaceholder: string;
    filterAll: string;
    empty: { title: string; hint: string };
    /** Column headings for the list view, in the order they are laid out. */
    columns: {
      case: string;
      status: string;
      commitments: string;
      deadline: string;
      third: string;
      fourth: string;
    };
  };
  caseDetail: {
    commitments: PageHeading;
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
    /** Column headings for the queue, in the order they are laid out. */
    columns: {
      subject: string;
      status: string;
      shares: string;
      recipient: string;
      purpose: string;
      raised: string;
    };
    disclosedLabel: string;
    withheldLabel: string;
    approveLabel: string;
    declineLabel: string;
    actingAs: string;
  };
  sidebar: {
    sectionLabel: string;
    footerNote: string;
  };
  /**
   * The scope of the product, and how to work inside it.
   *
   * This is the whole of it: what CaseRelay is for, what it refuses, the rules
   * that enforce the refusals, and the walkthroughs for each screen. It is one
   * tab rather than a footnote on every page, because guidance repeated six
   * times is guidance nobody reads once.
   *
   * The limits are the point — but a list of refusals on its own reads as a
   * disclaimer, so each one is preceded by the thing CaseRelay does instead.
   */
  guidelines: {
    /** The claim the page opens with. */
    label: string;
    intro: string;
    footnote: string;
    /**
     * The two scope lists are not written here: they are the authority grant's
     * own scopes, read through `AUTHORITY_GRANT`. Copy that restated them could
     * go stale against the order it claims to describe.
     */
    permitted: PageHeading;
    excluded: PageHeading;
    howTo: Section<HowTo>;
    rules: PageHeading;
    limits: Section<Limit>;
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
    approvalDetail: {
      title: "Before this is sent",
      subtitle: "The exact message, exactly what it shares, and what it is based on.",
    },
    registry: { title: "Not in this view", subtitle: "" },
    audit: { title: "Not in this view", subtitle: "" },
    admin: { title: "Not in this view", subtitle: "" },
    guidelines: {
      title: "Guidelines",
      subtitle: "What CaseRelay will do for you, what it will never do, and how to use each screen.",
    },
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
  },
  cases: {
    listing: {
      title: "Your caseload",
      subtitle: "Sorted so the children waiting longest come first.",
    },
    searchPlaceholder: "Search by child, case number, or county",
    filterAll: "All my cases",
    empty: { title: "No case matches that search.", hint: "Try a different name or case number." },
    columns: {
      case: "Child",
      status: "Status",
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
    columns: {
      subject: "Child",
      status: "Status",
      shares: "Shares",
      recipient: "Goes to",
      purpose: "Why",
      raised: "Asked you",
    },
    disclosedLabel: "This message will share",
    withheldLabel: "This message will not share",
    approveLabel: "Approve and send",
    declineLabel: "Do not send",
    actingAs: "You are approving as",
  },
  sidebar: {
    sectionLabel: "My work",
    footerNote: "No real child, family, or school record is used anywhere in this demonstration.",
  },
  guidelines: {
    label: "What CaseRelay is for",
    intro:
      "CaseRelay keeps track of whether someone has taken responsibility for a step, and chases the steps nobody has claimed. That is the whole job.",
    footnote: "Everything else stays with you, the court, and the professionals involved.",
    permitted: {
      title: "What you are allowed to do",
      subtitle: "Set by the court order your supervisor verified.",
    },
    excluded: {
      title: "What nobody here decides",
      subtitle: "These belong to the court and the professionals involved.",
    },
    howTo: {
      title: "How to use CaseRelay",
      subtitle: "Four things you will do most often, in the order you would do them.",
      items: [
        {
          title: "Start your day on Today",
          icon: "home",
          href: "/",
          steps: [
            "Read “Needs your attention” first. Those are steps nobody has taken responsibility for yet, and they are the only things on the page that are stuck.",
            "Check “Waiting on you” for messages CaseRelay has drafted and cannot send until you say yes.",
            "Skim “Moved forward without you asking”. That already happened while you were away — it is there so you know, not so you act.",
          ],
        },
        {
          title: "When a step has no owner",
          icon: "alert",
          href: "/cases",
          steps: [
            "Open the case and find the step. It names the one organization it belongs to.",
            "Look at how long it has been waiting. CaseRelay has already been chasing it — the day count is how long nobody has answered.",
            "Ask CaseRelay to draft a follow-up. It will write the message and bring it to you.",
            "Nothing reaches the organization until you have read that message and approved it.",
          ],
        },
        {
          title: "Approve a message before it is sent",
          icon: "approvals",
          href: "/approvals",
          steps: [
            "Open “Needs my approval” and read the message itself — use “Read the message first” to see the exact wording.",
            "Check the two lists beside it: what the message will share, and what it will not.",
            "Look at “What this is based on” if you want to see the document a claim came from.",
            "Choose “Approve and send” or “Do not send”. If you do nothing, nothing is sent.",
          ],
        },
        {
          title: "Ask CaseRelay a question",
          icon: "sparkle",
          steps: [
            "Open the chat panel and ask about any case you are appointed to.",
            "It can read the documents on the case, summarise where a step stands, and draft wording for you.",
            "It cannot contact anyone, decide anything, or act without your approval. If you ask it to, it will say no and tell you why.",
          ],
        },
      ],
    },
    rules: {
      title: "Promises CaseRelay keeps",
      subtitle: "These are fixed rules, not judgement calls the software makes each time.",
    },
    limits: {
      title: "Limits",
      subtitle: "Worth knowing before you rely on anything here.",
      items: [
        {
          title: "Nothing on this site is real",
          icon: "shield",
          body: "Every child, family, school, and court order in this walkthrough is made up for a demonstration. CaseRelay is not connected to any real case system and is not endorsed by National CASA/GAL.",
        },
        {
          title: "Decisions about a child are never CaseRelay's",
          icon: "lock",
          body: "It never decides where a child lives, what care they receive, what services they qualify for, or how their case should be argued. It only tracks whether the people responsible for those things have done what they promised.",
        },
        {
          title: "It can write, it cannot send",
          icon: "user",
          body: "CaseRelay reads documents and drafts wording. It cannot choose who to contact, what to share, or when to send — those are fixed rules and your decision.",
        },
      ],
    },
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
    approvalDetail: {
      title: "Held action",
      subtitle: "Drafted payload, computed projection, evidence provenance, and applied rule IDs.",
    },
    registry: {
      title: "Agent registry",
      subtitle: "Versioned cards, owning organizations, declared scopes, and denied scopes.",
    },
    audit: {
      title: "Traces & audit",
      subtitle: "One correlated trace across discovery, runtime, gateway, armor, policy, and completion.",
    },
    admin: {
      title: "Synthetic Data Lab",
      subtitle: "Create test cases from named scenarios, run the agent fleet, and watch live events.",
    },
    guidelines: {
      title: "Operating envelope",
      subtitle: "Enforced constraints, the rules that implement them, and how to read each console.",
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
  },
  cases: {
    listing: {
      title: "Durable executions",
      subtitle: "One workflow per case reference, ranked by open commitment age.",
    },
    searchPlaceholder: "Search by case reference, workflow, or county",
    filterAll: "All workflows",
    empty: { title: "No workflow matches that query.", hint: "Try a case reference or filter." },
    columns: {
      case: "Workflow",
      status: "State",
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
    columns: {
      subject: "Request",
      status: "State",
      shares: "Projection",
      recipient: "Recipient",
      purpose: "Purpose",
      raised: "Raised",
    },
    disclosedLabel: "Disclosed set",
    withheldLabel: "Withheld set",
    approveLabel: "Approve and dispatch",
    declineLabel: "Deny",
    actingAs: "Acting as human principal",
  },
  sidebar: {
    sectionLabel: "Platform",
    footerNote: "Synthetic fixtures. Nothing in this build is deployed and no request leaves the browser.",
  },
  guidelines: {
    label: "Operating envelope",
    intro:
      "Constraints the runtime enforces before any outbound effect — not conventions a model is asked to follow.",
    footnote: "Violations quarantine the payload rather than degrade the response.",
    permitted: {
      title: "Granted scopes",
      subtitle: "Purposes carried in the request envelope.",
    },
    excluded: {
      title: "Denied scopes",
      subtitle: "Rejected at the gateway regardless of caller.",
    },
    howTo: {
      title: "Reading the consoles",
      subtitle: "What each surface is authoritative for, and where the evidence sits.",
      items: [
        {
          title: "Trace a request end to end",
          icon: "audit",
          href: "/audit",
          steps: [
            "Open Traces & audit. One correlated trace spans discovery, runtime, gateway, Model Armor, policy, and completion.",
            "Expand a span for its actor identity, elapsed time, and the rule IDs evaluated inside it.",
            "The policy decisions list is the authority for an outcome — each entry carries the rule that fired, not a post-hoc summary.",
          ],
        },
        {
          title: "Check what an agent can reach",
          icon: "agents",
          href: "/registry",
          steps: [
            "Open the Agent registry and select the agent. Its versioned card declares the owning organization, service identity, granted scopes, and denied scopes.",
            "The gateway computes every projection from that card, so a denied scope is unreachable by construction rather than filtered on the way out.",
            "A capability with no proof recorded shows as unverified. Treat it as unproven, not as working.",
          ],
        },
        {
          title: "Read a field projection",
          icon: "gateway",
          href: `/cases/${PRIMARY_CASE_ID}`,
          steps: [
            "Open the workflow and find the gateway projection for the outbound call.",
            "The disclosed set is the minimum-necessary field list computed for that purpose. The withheld set names each field and the rule that withheld it.",
            "The orchestrator never held the withheld fields either — cross-domain records are unreachable, so there is no assembled record to leak.",
          ],
        },
        {
          title: "Interpret a refusal",
          icon: "shield",
          href: "/approvals",
          steps: [
            "A quarantine sets the partner payload aside before it enters any agent context. Nothing downstream sees the instruction.",
            "The rule ID on the decision is the authority for the refusal, and the response carries an explanation rather than private chain-of-thought.",
            "A bounded retry reuses the original idempotency key, so a repeated attempt cannot repeat the business effect.",
          ],
        },
      ],
    },
    rules: {
      title: "Policy rules in force",
      subtitle: "Deterministic evaluation order, applied before any outbound effect.",
    },
    limits: {
      title: "Limits",
      subtitle: "What this build is and is not evidence of.",
      items: [
        {
          title: "Synthetic fixtures throughout",
          icon: "shield",
          body: "No agent is deployed behind this build, no request leaves the browser, and health and latency figures are illustrative. Every case, identity, and trace is fabricated.",
        },
        {
          title: "Deterministic code owns the consequential path",
          icon: "lock",
          body: "Authorization, field projection, deadline thresholds, retries, state transitions, approval requirements, and idempotency are code. The model only extracts, classifies, and drafts.",
        },
        {
          title: "Explanations, not chain-of-thought",
          icon: "sparkle",
          body: "Agents return evidence references, applied rule IDs, and human-readable explanations. Private reasoning traces are never surfaced, logged, or persisted.",
        },
      ],
    },
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

/**
 * The same policy rules, read as promises rather than as controls. Keyed by rule
 * ID so the plain wording and the enforced rule cannot drift into describing
 * different things — every ID in `POLICY_RULES` needs an entry here.
 */
const PLAIN_RULES: Record<string, { title: string; summary: string }> = {
  "POL-AUTH-004": {
    title: "A verified court order first",
    summary: "Nothing starts until a supervisor has confirmed you are appointed to the case.",
  },
  "POL-OWN-006": {
    title: "Somebody is always responsible",
    summary:
      "A step with no named person responsible for it is treated as a problem, not as work in progress.",
  },
  "POL-PROJ-011": {
    title: "Only what the question needs",
    summary:
      "Whoever is asked a question is told only what that question needs. Nothing else is included.",
  },
  "POL-INJ-002": {
    title: "Outside messages cannot give instructions",
    summary:
      "If a reply from another organization tries to tell CaseRelay what to do, it is set aside and never acted on.",
  },
  "POL-ESC-007": {
    title: "A person approves every message out",
    summary:
      "CaseRelay cannot contact another organization until you have read the message and agreed.",
  },
  "POL-IDEM-001": {
    title: "Never sent twice",
    summary: "If CaseRelay retries, the same message will not reach anyone a second time.",
  },
  "POL-RET-003": {
    title: "Closed cases stop being watched",
    summary:
      "When a case closes, CaseRelay stops checking on it and keeps only what it is required to keep, for only as long as it must.",
  },
};

export function ruleCopy(
  rule: { id: string; title: string; summary: string },
  technical: boolean,
) {
  if (technical) return rule;
  return PLAIN_RULES[rule.id] ?? rule;
}

/**
 * Authorized purposes, said the way you would explain them to the person whose
 * approval is being asked for. Keyed by the purpose carried in the request
 * envelope, so the sentence and the scope it describes cannot come apart.
 */
const PLAIN_PURPOSES: Record<string, string> = {
  verify_school_enrollment: "To confirm she is enrolled at school",
  confirm_legal_referral_status: "To check her lawyer referral is moving",
  confirm_shelter_referral_status: "To find out who is handling her shelter referral",
  confirm_appointment_completed: "To confirm her medical appointment happened",
};

export function purposeLabel(purpose: string, technical: boolean) {
  if (technical) return purpose;
  return PLAIN_PURPOSES[purpose] ?? purpose.replace(/_/g, " ");
}
