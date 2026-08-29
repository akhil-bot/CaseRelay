import type { IconName } from "@/components/icons";
import type { Role } from "@/design/personas";
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
    /** No subtitle: the line under the title is the live result count, not copy. */
    listing: { title: string };
    searchPlaceholder: string;
    filterAll: string;
    /** Stands in for the child's name on a referral that has not named one yet. */
    unnamed: string;
    empty: { title: string; hint: string };
    /** No cases at all, as against none matching the search — a different problem. */
    none: { title: string; hint: string };
    /** Column headings for the list view, in the order they are laid out. */
    columns: {
      case: string;
      status: string;
      commitments: string;
      deadline: string;
      opened: string;
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
  /**
   * The gates that stop a case where it stands — activating one, or releasing
   * something that was quarantined. Read from the control plane, so an empty
   * screen here means the agents are genuinely unblocked.
   */
  approvals: {
    gates: PageHeading;
    empty: { title: string; hint: string };
  };
  /** Group headings are the role's own — see NAV_BY_ROLE in design/personas.ts. */
  sidebar: {
    /**
     * The standing note in the sidebar footer. It is addressed to the volunteer
     * rather than describing the product, because it is the one piece of copy a
     * person sees on every screen and it should be worth reading twice.
     */
    footerTitle: string;
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
      subtitle: "A case stops here until you have read what is waiting and decided.",
    },
    registry: {
      title: "Agent registry",
      subtitle: "Which agents are authorized to work on cases, and what each one can access.",
    },
    audit: {
      title: "Audit trail",
      subtitle: "Every action taken on the case, who took it, and which rule applied.",
    },
    admin: {
      title: "Synthetic Data Lab",
      subtitle: "Create a case, start outreach, and watch the activity live.",
    },
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
      title: "Your caseload, step by step",
      subtitle: "Open a child to see how far their court-ordered steps have got.",
    },
    stats: {
      owner: "Steps with no owner",
      waiting: "Waiting on you",
      open: "Steps still open",
      steps: "Checks done for you",
    },
    statNotes: {
      owner: "Nobody has claimed these",
      waiting: "Cases that cannot move without you",
      open: "Across Maya's case",
      steps: "Since the case opened",
    },
    attentionEmpty: {
      title: "Nothing is overdue right now.",
      hint: "Every step has someone responsible and a date that has not passed.",
    },
  },
  cases: {
    listing: { title: "Your caseload" },
    searchPlaceholder: "Search by child, case number, or status",
    filterAll: "All my cases",
    unnamed: "No child named yet",
    empty: { title: "No case matches that search.", hint: "Try a different name or case number." },
    none: {
      title: "You have no cases yet.",
      hint: "A case appears here as soon as a referral is opened for you.",
    },
    columns: {
      case: "Child",
      status: "Status",
      commitments: "Steps done",
      deadline: "Next due date",
      opened: "Opened",
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
    gates: {
      title: "Paused until you decide",
      subtitle:
        "These cases have stopped where they are. Nobody is contacted and nothing is shared while they wait.",
    },
    empty: {
      title: "Nothing is waiting on you.",
      hint: "When a case cannot go any further without you, it will stop here and say so.",
    },
  },
  sidebar: {
    footerTitle: "Why you're here",
    footerNote:
      "A child in care can meet dozens of professionals in a year. You are the one who stays. CaseRelay chases the handoffs so your hours go to them, not to the paperwork.",
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
          title: "Decide on a case that has stopped",
          icon: "approvals",
          href: "/approvals",
          steps: [
            "Open “Needs my approval”. Everything listed there is a case that cannot go any further without you.",
            "Read what the card says will happen if you approve — either starting outreach on a new case, or releasing something that was held back.",
            "Open the case itself if you want the fuller picture. Each card links straight to it.",
            "Approve or reject. If you do nothing, nothing happens and the case stays where it is.",
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

export const COPY: PersonaCopy = advocate;

/**
 * Where a role needs different words for a screen it shares.
 *
 * COPY is written in the advocate's first person — "Your caseload", "All my
 * cases" — which is right for the person whose cases they are and wrong for the
 * supervisor reading their team's. Only the lines that actually change are here.
 *
 * Two levels deep and no further, on purpose: a general deep merge would make it
 * impossible to see from here what a role has and has not overridden. Wording
 * that changes with something other than the role — the Today page's "waiting on
 * you", which turns on who can act — stays a condition at its own call site.
 */
export const ROLE_COPY: Partial<
  Record<
    Role,
    {
      pages?: Partial<PersonaCopy["pages"]>;
      cases?: Partial<PersonaCopy["cases"]>;
    }
  >
> = {
  supervisor: {
    pages: {
      overview: {
        title: "Today",
        subtitle: "What has stopped, and which of your advocates is waiting on you.",
      },
      cases: {
        title: "Team caseload",
        subtitle: "Every child your advocates carry, grouped by who is responsible.",
      },
    },
    cases: {
      listing: { title: "Team caseload" },
      searchPlaceholder: "Search by child, advocate, case number, or status",
      filterAll: "All cases",
      none: {
        title: "Your advocates have no cases yet.",
        hint: "A case appears here as soon as a referral is opened for one of them.",
      },
    },
  },
};

/** COPY as this role reads it. Shared wording where a role said nothing. */
export function copyFor(role: Role): PersonaCopy {
  const override = ROLE_COPY[role];
  if (!override) return COPY;
  return {
    ...COPY,
    pages: { ...COPY.pages, ...override.pages },
    cases: { ...COPY.cases, ...override.cases },
  };
}

/** Field paths, translated to the words a person would say out loud. */
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

export function fieldLabel(field: string) {
  return FIELD_LABELS[field] ?? field.split(".").pop()?.replace(/_/g, " ") ?? field;
}

/**
 * Policy rules stated as plain promises. Keyed by rule ID so the wording and
 * the enforced rule cannot drift apart — every ID in POLICY_RULES needs an entry.
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

export function ruleCopy(rule: { id: string; title: string; summary: string }) {
  return PLAIN_RULES[rule.id] ?? rule;
}

/**
 * Authorized purposes stated plainly. Keyed by the purpose in the request
 * envelope so the sentence and the scope it describes cannot come apart.
 */
const PLAIN_PURPOSES: Record<string, string> = {
  verify_school_enrollment: "To confirm she is enrolled at school",
  confirm_legal_referral_status: "To check her lawyer referral is moving",
  confirm_shelter_referral_status: "To find out who is handling her shelter referral",
  confirm_appointment_completed: "To confirm her medical appointment happened",
};

export function purposeLabel(purpose: string) {
  return PLAIN_PURPOSES[purpose] ?? purpose.replace(/_/g, " ");
}
