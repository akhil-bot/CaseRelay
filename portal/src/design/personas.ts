import type { IconName } from "@/components/icons";
import type { Tone } from "@/design/tokens";

export interface PersonaProfile {
  id: string;
  name: string;
  role: string;
  org: string;
  email: string;
  viewLabel: string;
  accountLabel: string;
  viewHint: string;
  icon: IconName;
  tone: Tone;
}

export const PERSONAS = {
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
  } satisfies PersonaProfile,
};

export const PERSONA_ORDER = ["advocate"] as const;

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  badge?: "approvals";
}

export const NAV: NavItem[] = [
  { href: "/", label: "Today", icon: "home" },
  { href: "/cases", label: "My cases", icon: "cases" },
  { href: "/approvals", label: "Needs my approval", icon: "approvals", badge: "approvals" },
  { href: "/registry", label: "Agent registry", icon: "agents" },
  { href: "/audit", label: "Audit trail", icon: "audit" },
  { href: "/admin", label: "Synthetic Data Lab", icon: "sparkle" },
  { href: "/guidelines", label: "Guidelines", icon: "book" },
];

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
  if (pathname.startsWith("/approvals/")) return "approvalDetail";
  if (pathname.startsWith("/approvals")) return "approvals";
  if (pathname.startsWith("/registry")) return "registry";
  if (pathname.startsWith("/audit")) return "audit";
  if (pathname.startsWith("/guidelines")) return "guidelines";
  return "overview";
}
