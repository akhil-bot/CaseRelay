/**
 * ── Reading a live case ──────────────────────────────────────────────────────
 * The control plane speaks in phases, specialists, and event types. Three
 * surfaces — the activity feed, the needs-attention block, and the audit trail —
 * have to say the same thing about the same underlying event, so the vocabulary
 * and the field-reading live here rather than three times over.
 *
 * Nothing in this file invents a date or a status. Where the case does not carry
 * a fact, the caller gets nothing back and shows nothing.
 */

import { useSyncExternalStore } from "react";
import type { IconName } from "@/components/icons";
import { DOMAIN_META } from "@/components/ui/primitives";
import type { Tone } from "@/design/tokens";
import type { RunEvent } from "@/lib/api";
import type { Domain } from "@/lib/types";

/** Fan-out phases are labelled by specialist; a volunteer reads them as services. */
const SPECIALIST_DOMAIN: Record<string, Domain> = {
  education_liaison: "education",
  health_coordination: "health",
  legal_aid: "legal",
  shelter_status: "shelter",
  family_services: "family_services",
};

/** Which service an event concerns, or null where it concerns the case as a whole. */
export function eventDomain(ev: RunEvent): Domain | null {
  const commitmentType = typeof ev.commitment_type === "string" ? ev.commitment_type : "";
  if (commitmentType in DOMAIN_META) return commitmentType as Domain;

  const phase = ev.phase ?? "";
  if (phase.startsWith("3-fanout-")) {
    return SPECIALIST_DOMAIN[phase.slice("3-fanout-".length)] ?? null;
  }
  // The post-approval follow-up belongs to the school, matching the backend's
  // own phase-to-service map.
  if (phase === "8-followup") return "education";
  return null;
}

export function commitmentStatus(ev: RunEvent, domain: Domain | null): string {
  if (!domain) return "";
  const states = ev.commitment_states as Record<string, string> | undefined;
  return states?.[domain] ?? "";
}

/** Commitment state decides the colour; the domain decides the glyph. */
export const STATUS_TONE: Record<string, Tone> = {
  completed: "seal",
  blocked: "danger",
  unresolved: "warn",
  scheduled: "accent",
};

// ─── Time ─────────────────────────────────────────────────────────────────────

/**
 * A case can run for three weeks or, in a demonstration, for two minutes. Dates
 * are the only sensible unit at one end and clock times the only sensible unit
 * at the other, so the span picks.
 */
export type TimeScale = "time" | "day";

export function scaleFor(spanMs: number): TimeScale {
  return spanMs < 12 * 60 * 60 * 1000 ? "time" : "day";
}

/**
 * Now, as something React can subscribe to.
 *
 * Whether a deadline has passed, and where "today" falls on the timeline, both
 * depend on the current time — which is not case data and must not be read
 * during a render. The clock ticks once a minute: fine enough for a rail
 * measured in days, cheap enough to leave running on an open case.
 */
let clockNow = 0;
let clockTimer: ReturnType<typeof setInterval> | null = null;
const clockListeners = new Set<() => void>();

function subscribeToClock(onChange: () => void): () => void {
  clockListeners.add(onChange);
  clockTimer ??= setInterval(() => {
    clockNow = Date.now();
    clockListeners.forEach((listener) => listener());
  }, 60_000);

  return () => {
    clockListeners.delete(onChange);
    if (clockListeners.size === 0 && clockTimer !== null) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}

function readClock(): number {
  if (clockNow === 0) clockNow = Date.now();
  return clockNow;
}

/** Zero until the browser has it, so nothing time-dependent renders on the server. */
export function useNow(): number {
  return useSyncExternalStore(subscribeToClock, readClock, () => 0);
}

export function parseTime(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

export function formatEventTime(ts: string | undefined): string {
  if (!ts) return "";
  const ms = parseTime(ts);
  if (ms === null) return "";
  return new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatElapsed(fromTs: string | undefined, toTs: string | undefined): string {
  const from = parseTime(fromTs);
  const to = parseTime(toTs);
  if (from === null || to === null) return "";
  return formatSpan(Math.abs(to - from));
}

/** A duration, said the way someone would say it out loud. */
function formatSpan(ms: number): string {
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h\u202f${mins % 60}m`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

/** A date, at whichever precision the case's own pace makes readable. */
export function formatMoment(ms: number, scale: TimeScale): string {
  const at = new Date(ms);
  if (scale === "time") {
    return at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return at.toLocaleDateString([], { day: "numeric", month: "short" });
}

/** A follow-up date, named relative to today where that is what a person would say. */
export function formatFollowUp(ts: unknown): string {
  const ms = parseTime(ts);
  if (ms === null) return "";
  const due = new Date(ms);
  if (due.toDateString() === new Date().toDateString()) {
    return `today at ${due.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }
  return due.toLocaleDateString([], { day: "numeric", month: "short" });
}

/**
 * A scheduled time, always shown as a concrete local clock time so the viewer
 * knows exactly when the follow-up is — never a vague relative word.
 *
 * Returns "" when now === 0, which is the server snapshot from useNow(). This
 * prevents a hydration mismatch: both server and client agree on an empty string
 * until the clock is live in the browser, at which point the real value fills in.
 *
 * Past times are described as "was due at …" so they do not read as a broken
 * future promise — this was the original complaint that drove earlier attempts
 * at relative formatting.
 */
export function formatScheduledAt(ts: unknown, now: number): string {
  if (now === 0) return "";
  const ms = parseTime(ts);
  if (ms === null) return "";

  const at = new Date(ms);
  const timeStr = at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
  const isToday = at.toDateString() === new Date(now).toDateString();
  const isPast = ms < now;

  if (isToday) {
    if (isPast) return `was due at ${timeStr}`;
    return `due at ${timeStr}`;
  }
  const dateStr = at.toLocaleDateString([], { month: "short", day: "numeric" });
  if (isPast) return `was due ${dateStr} at ${timeStr}`;
  return `due ${dateStr} at ${timeStr}`;
}

// ─── The audit trail's vocabulary ─────────────────────────────────────────────

export interface AuditView {
  label: string;
  icon: IconName;
  variant: Tone;
}

/**
 * Every event type the backend writes to the audit log, in the same words the
 * activity feed uses for the same moment.
 */
const AUDIT_META: Record<string, AuditView> = {
  disclosure: { label: "Information shared", icon: "gateway", variant: "brand" },
  denial: { label: "Request refused", icon: "close", variant: "danger" },
  quarantine: { label: "Reply held for review", icon: "shield", variant: "danger" },
  followup: { label: "Follow-up sent", icon: "mail", variant: "neutral" },
  unresponsive_partner: {
    label: "Nobody answered — supervisor told",
    icon: "user",
    variant: "warn",
  },
  workflow_wake: { label: "Checked back on the case", icon: "sleep", variant: "accent" },
  commitment_deferred: { label: "Step moved to a later date", icon: "clock", variant: "neutral" },
};

export function auditView(eventType: string): AuditView {
  return (
    AUDIT_META[eventType] ?? {
      label: eventType.replace(/_/g, " "),
      icon: "document",
      variant: "neutral",
    }
  );
}

// ─── What each commitment is called ───────────────────────────────────────────

interface SummaryCommitment {
  domain: string;
  label: string;
  status: string;
}

/**
 * The wording the backend used for each commitment in its closing summary, which
 * names the thing itself ("school enrollment request") rather than the service.
 * Falls back to the service name when no run has summarised the case yet.
 */
export function commitmentLabels(events: RunEvent[]): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const ev of events) {
    if (ev.event !== "run_summary") continue;
    for (const c of (ev.commitments ?? []) as SummaryCommitment[]) {
      if (c.domain && c.label) labels[c.domain] = c.label;
    }
  }
  return labels;
}

export function commitmentTitle(domain: Domain, labels: Record<string, string>): string {
  const label = labels[domain] ?? DOMAIN_META[domain].label;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// ─── Deadlines the case actually carries ──────────────────────────────────────

/**
 * Per-commitment deadlines, read from the events that carry them: the
 * reconciliation sweep that compares every deadline against the clock, and the
 * overdue notices it raises. A commitment whose deadline has never appeared in
 * either is left out — there is nowhere else to get one from.
 */
export function commitmentDeadlines(events: RunEvent[]): Map<Domain, number> {
  const deadlines = new Map<Domain, number>();

  const remember = (type: unknown, deadline: unknown) => {
    if (typeof type !== "string" || !(type in DOMAIN_META)) return;
    const ms = parseTime(deadline);
    if (ms !== null) deadlines.set(type as Domain, ms);
  };

  for (const ev of events) {
    if (ev.event === "reconciliation" && Array.isArray(ev.results)) {
      for (const r of ev.results as Record<string, unknown>[]) {
        remember(r.type, r.deadline);
      }
    } else if (ev.event === "commitment_overdue") {
      remember(ev.commitment_type, ev.deadline);
    }
  }
  return deadlines;
}

/** The follow-up the case is currently waiting on, if it has said it is waiting. */
export function nextFollowUpAt(events: RunEvent[]): number | null {
  let latest: number | null = null;
  for (const ev of events) {
    if (ev.event !== "run_suspended") continue;
    const ms = parseTime(ev.checkpoint_due);
    if (ms !== null) latest = ms;
  }
  return latest;
}
