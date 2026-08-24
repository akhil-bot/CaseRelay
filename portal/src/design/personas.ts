import type { IconName } from "@/components/icons";
import type { Tone } from "@/design/tokens";

/**
 * Two people use CaseRelay and they need different products.
 *
 * `advocate` is a CASA volunteer. She is not technical, she is accountable for a
 * child's next step, and she should never be shown a trace ID or a policy rule
 * number to do her job.
 *
 * `platform` is the person who operates the agent fleet. They need identities,
 * scopes, spans, checkpoints, and refusals — and they have no business reading
 * case narrative they were not appointed to.
 */
export type Persona = "advocate" | "platform";

export interface PersonaProfile {
  id: Persona;
  name: string;
  role: string;
  org: string;
  email: string;
  /** Short label for the view switcher. */
  viewLabel: string;
  /** What the account is called at sign-in, where you are picking a person, not a view. */
  accountLabel: string;
  /** What this view contains. Short enough to sit under its own label in a menu. */
  viewHint: string;
  icon: IconName;
  /**
   * The colour this person carries wherever both views are on screen at once —
   * avatar, role badge, view switcher. Stated here so those never drift apart.
   */
  tone: Tone;
}

export const PERSONAS: Record<Persona, PersonaProfile> = {
  advocate: {
    id: "advocate",
    name: "Elena Vasquez",
    role: "CASA volunteer advocate",
    org: "Mesa County CASA",
    email: "elena.v@mesacasa.example",
    viewLabel: "Advocate",
    accountLabel: "Advocate",
    viewHint: "Cases, next steps, and approvals.",
    icon: "user",
    tone: "brand",
  },
  platform: {
    id: "platform",
    name: "Priya Raghavan",
    role: "Platform administrator",
    org: "CaseRelay platform team",
    email: "priya.r@caserelay.example",
    viewLabel: "Platform",
    accountLabel: "Admin",
    viewHint: "Agents, scopes, traces, and policy.",
    icon: "code",
    tone: "accent",
  },
};

export const PERSONA_ORDER: Persona[] = ["advocate", "platform"];

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  badge?: "approvals";
}

/** Navigation is defined per persona, so a view can never link somewhere it should not go. */
export const NAV: Record<Persona, NavItem[]> = {
  advocate: [
    { href: "/", label: "Today", icon: "home" },
    { href: "/cases", label: "My cases", icon: "cases" },
    { href: "/approvals", label: "Needs my approval", icon: "approvals", badge: "approvals" },
    { href: "/guidelines", label: "Guidelines", icon: "book" },
  ],
  platform: [
    { href: "/", label: "Fleet health", icon: "home" },
    { href: "/admin", label: "Synthetic Data Lab", icon: "sparkle" },
    { href: "/registry", label: "Agent registry", icon: "agents" },
    { href: "/audit", label: "Traces & audit", icon: "audit" },
    { href: "/approvals", label: "Policy queue", icon: "shield", badge: "approvals" },
    { href: "/cases", label: "Workflows", icon: "cases" },
    { href: "/guidelines", label: "Guidelines", icon: "book" },
  ],
};

/** Routes only one view is allowed to open. */
export const PLATFORM_ONLY_ROUTES = ["/registry", "/audit", "/admin"];

export function isRouteAllowed(pathname: string, persona: Persona) {
  if (persona === "platform") return true;
  return !PLATFORM_ONLY_ROUTES.some((route) => pathname.startsWith(route));
}

export type PageKey =
  | "overview"
  | "cases"
  | "caseDetail"
  | "approvals"
  | "approvalDetail"
  | "registry"
  | "audit"
  | "admin"
  | "guidelines";

export function pageKeyFor(pathname: string): PageKey {
  if (pathname.startsWith("/admin")) return "admin";
  if (pathname.startsWith("/cases/")) return "caseDetail";
  if (pathname.startsWith("/cases")) return "cases";
  // Before the queue itself, so the trailing segment wins.
  if (pathname.startsWith("/approvals/")) return "approvalDetail";
  if (pathname.startsWith("/approvals")) return "approvals";
  if (pathname.startsWith("/registry")) return "registry";
  if (pathname.startsWith("/audit")) return "audit";
  if (pathname.startsWith("/guidelines")) return "guidelines";
  return "overview";
}
