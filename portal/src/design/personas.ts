import type { IconName } from "@/components/icons";
import type { Tone } from "@/design/tokens";

/**
 * Who is looking.
 *
 * Three people use CaseRelay and they are not interchangeable. The volunteer
 * advocate works their own cases. The supervisor holds the authority the
 * advocate does not — they are the only one who can let a case start or release
 * something a guardrail caught. The admin runs the fleet the other two depend
 * on: which agents are callable, what each may see, and the record of what they
 * actually did. They make no decision on any case.
 *
 * The role decides what the sidebar offers, whose name is written to a decision,
 * and which screens exist at all. It is chosen at sign-in and can be changed
 * from the profile menu.
 */
export type Role = "advocate" | "supervisor" | "admin";

export interface PersonaProfile {
  id: Role;
  name: string;
  role: string;
  org: string;
  email: string;
  viewLabel: string;
  accountLabel: string;
  viewHint: string;
  /**
   * The `volunteer_id` on the case records that are this person's own.
   *
   * Set only for the advocate, and only because `GET /v1/cases` has no volunteer
   * filter: it returns every case, so "My cases" has to be narrowed here. A
   * supervisor's list is deliberately not narrowed — the whole team is theirs.
   */
  volunteerId?: string;
  /** The form's own heading. What you are signing in *to* differs by role. */
  signIn: { title: string; subtitle: string };
  icon: IconName;
  tone: Tone;
}

export const PERSONAS: Record<Role, PersonaProfile> = {
  advocate: {
    id: "advocate",
    name: "Elena Vasquez",
    role: "CASA volunteer advocate",
    org: "Mesa County CASA",
    email: "elena.v@mesacasa.example",
    viewLabel: "Advocate",
    accountLabel: "Advocate",
    viewHint: "Your own cases and the steps still owed on them.",
    volunteerId: "elena-volunteer-001",
    signIn: {
      title: "Sign in to your cases",
      subtitle: "Use the email your CASA program has on file.",
    },
    icon: "user",
    tone: "brand",
  },
  supervisor: {
    id: "supervisor",
    name: "Dana Whitfield",
    role: "CASA program supervisor",
    org: "Mesa County CASA",
    email: "dana.w@mesacasa.example",
    viewLabel: "Supervisor",
    accountLabel: "Supervisor",
    viewHint: "Approve what a case cannot start or continue without.",
    signIn: {
      title: "Sign in to supervise",
      subtitle: "Use the email your CASA program has on file.",
    },
    icon: "users",
    tone: "accent",
  },
  admin: {
    id: "admin",
    name: "Ray Okonkwo",
    role: "Platform administrator",
    org: "CaseRelay operations",
    email: "ray.o@caserelay.example",
    viewLabel: "Admin",
    accountLabel: "Admin",
    viewHint: "The agent fleet, the audit trail, and the data lab.",
    signIn: {
      title: "Sign in to the fleet console",
      subtitle: "Use your CaseRelay operations account.",
    },
    icon: "sparkle",
    tone: "seal",
  },
};

/** Sign-in order, and the order the profile menu offers them in. */
export const ROLE_ORDER: Role[] = ["advocate", "supervisor", "admin"];

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  badge?: "approvals";
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Each role's whole sidebar, written out rather than derived by filtering one
 * list. Two reasons: a role can name a shared screen in its own words ("My
 * cases" for the advocate is "Cases" to everyone else), and the sidebar can
 * render all three and let CSS reveal one, which is what keeps the nav from
 * painting the wrong role's items before React knows who is looking.
 *
 * Approvals appear only under the supervisor. The gate is theirs to decide and
 * a queue an advocate cannot act on is a queue that should not be in their way.
 */
export const NAV_BY_ROLE: Record<Role, NavGroup[]> = {
  advocate: [
    {
      label: "My work",
      items: [
        { href: "/", label: "Today", icon: "home" },
        { href: "/cases", label: "My cases", icon: "cases" },
        { href: "/guidelines", label: "Guidelines", icon: "book" },
      ],
    },
  ],
  // No audit trail here. The supervisor does answer for the grants they
  // approve, but the record they need is case-scoped and already sits inside
  // the case they approved. /audit is a fleet-wide log keyed by event type and
  // trace — the administrator's tool, not a supervision screen.
  supervisor: [
    {
      label: "Supervision",
      items: [
        { href: "/", label: "Today", icon: "home" },
        { href: "/cases", label: "Cases", icon: "cases" },
        {
          href: "/approvals",
          label: "Needs my approval",
          icon: "approvals",
          badge: "approvals",
        },
        { href: "/guidelines", label: "Guidelines", icon: "book" },
      ],
    },
  ],
  // No caseload. /cases is a list of children with their names, their faces and
  // their next deadlines, and someone running the fleet has no business reading
  // it. What the administrator needs from a case is what the agents did to it,
  // which is the audit trail.
  admin: [
    {
      label: "Platform",
      items: [
        { href: "/registry", label: "Agent registry", icon: "agents" },
        { href: "/admin", label: "Synthetic Data Lab", icon: "sparkle" },
        { href: "/audit", label: "Audit trail", icon: "audit" },
      ],
    },
  ],
};

/** Where signing in as each role lands. An admin has no caseload to open on. */
export const ROLE_HOME: Record<Role, string> = {
  advocate: "/",
  supervisor: "/",
  admin: "/registry",
};

export type PageKey =
  | "overview"
  | "cases"
  | "caseDetail"
  | "approvals"
  | "registry"
  | "audit"
  | "admin"
  | "guidelines";

export function pageKeyFor(pathname: string): PageKey {
  if (pathname.startsWith("/admin")) return "admin";
  if (pathname.startsWith("/cases/")) return "caseDetail";
  if (pathname.startsWith("/cases")) return "cases";
  if (pathname.startsWith("/approvals")) return "approvals";
  if (pathname.startsWith("/registry")) return "registry";
  if (pathname.startsWith("/audit")) return "audit";
  if (pathname.startsWith("/guidelines")) return "guidelines";
  return "overview";
}
