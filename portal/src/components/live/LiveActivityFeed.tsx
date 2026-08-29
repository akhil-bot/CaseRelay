"use client";

import { Fragment, memo, useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/icons";
import { Badge, Card, DOMAIN_META, EmptyState, StatusBadge, cx } from "@/components/ui/primitives";
import { row, tone, type Tone, type as type_ } from "@/design/tokens";
import type { RunEvent } from "@/lib/api";
import {
  STATUS_TONE,
  commitmentStatus,
  eventDomain,
  formatElapsed,
  formatEventTime,
  formatFollowUp,
  formatScheduledAt,
  nextFollowUpAt,
  useNow,
} from "@/lib/case-events";
import type { LiveRunState } from "@/lib/live-case";
import type { CommitmentStatus, Domain } from "@/lib/types";

const HIDDEN_EVENTS = new Set([
  "connected",
  "stream_end",
  "stream_timeout",
  // The memory phase already reports that the notes were written.
  "memory_write",
]);

function genericIcon(ev: RunEvent): IconName {
  const phase = ev.phase ?? "";
  if (phase === "intake") return "document";
  if (phase.includes("activate")) return "approvals";
  if (phase.includes("wake")) return "sleep";
  if (phase.includes("nudge")) return "mail";
  if (ev.event === "run_started") return "play";
  if (ev.event === "run_completed") return "checkCircle";
  return "activity";
}

type Weight = "alert" | "attention" | "normal" | "quiet";

interface EventView {
  weight: Weight;
  icon: IconName;
  variant: Tone;
  message: string;
  /** A second line, only where the headline leaves an obvious question open. */
  note?: string;
  /** Rendered as a badge, only for the states a volunteer has to act on. */
  status?: CommitmentStatus;
}

/**
 * Grades one event and picks its glyph.
 *
 * Weight is the only input to row styling, so the two things a volunteer must
 * not miss — a reply the guardrail caught, and a commitment that cannot move —
 * are the only rows carrying a rule and a tint. Wording is the backend's
 * narration except where that narration repeats its neighbour or names
 * machinery nobody outside the system has words for.
 */
function describe(ev: RunEvent): EventView {
  const phase = ev.phase ?? "";
  const domain = eventDomain(ev);
  const status = commitmentStatus(ev, domain);
  const message = (typeof ev.message === "string" && ev.message) || ev.event.replace(/_/g, " ");
  const domainIcon = domain ? DOMAIN_META[domain].icon : null;

  if (ev.event === "run_suspended") {
    return { weight: "quiet", icon: "sleep", variant: "accent", message };
  }

  if (phase.includes("quarantine")) {
    return { weight: "alert", icon: "shield", variant: "danger", message };
  }

  if (status === "blocked") {
    return {
      weight: "alert",
      icon: domainIcon ?? "shield",
      variant: "danger",
      message,
      status: "blocked",
    };
  }

  if (ev.event === "phase_error" || ev.event === "run_failed") {
    return { weight: "alert", icon: domainIcon ?? "alert", variant: "danger", message };
  }

  if (ev.event === "reconciliation") {
    const overdue = Number(ev.overdue_count ?? 0);
    return overdue > 0
      ? { weight: "attention", icon: "clock", variant: "warn", message }
      : { weight: "quiet", icon: "list", variant: "neutral", message };
  }

  if (
    phase.includes("approve") ||
    phase.includes("unanswered") ||
    ev.event === "supervisor_notified" ||
    ev.event === "followup_ignored" ||
    ev.event === "commitment_overdue" ||
    ev.event === "run_partial_failure" ||
    status === "unresolved"
  ) {
    return {
      weight: "attention",
      icon: domainIcon ?? (ev.event === "supervisor_notified" ? "user" : "alert"),
      variant: "warn",
      message,
      status: status === "unresolved" ? "unresolved" : undefined,
    };
  }

  if (phase.includes("memory") || ev.event === "memory_recall") {
    return { weight: "quiet", icon: "memory", variant: "neutral", message };
  }

  if (ev.event === "run_started") {
    return { weight: "quiet", icon: "play", variant: "neutral", message };
  }

  return {
    weight: "normal",
    icon: domainIcon ?? genericIcon(ev),
    variant: STATUS_TONE[status] ?? (domain ? DOMAIN_META[domain].variant : "neutral"),
    message,
  };
}

// ─── Weight → styling ─────────────────────────────────────────────────────────

const WEIGHT_ROW: Record<Weight, string> = {
  alert: "border-l-2 border-l-danger/70 bg-danger/[0.04] py-3",
  attention: "border-l-2 border-l-warn/60 bg-warn-soft/30 py-2.5",
  normal: cx("py-2", row.hover),
  quiet: cx("py-1.5", row.hover),
};

const WEIGHT_TEXT: Record<Weight, string> = {
  alert: "text-[13px] font-semibold leading-relaxed text-ink",
  attention: "text-[12.5px] font-medium leading-relaxed text-ink",
  normal: "text-[12.5px] leading-relaxed text-ink-soft",
  quiet: "text-[11.5px] leading-relaxed text-ink-muted",
};

const WEIGHT_ICON_SIZE: Record<Weight, number> = {
  alert: 15,
  attention: 14,
  normal: 14,
  quiet: 12,
};

// ─── Terminal-state helpers ───────────────────────────────────────────────────

function terminalStateLabel(state: string): string {
  if (state === "completed") return "All steps complete";
  if (state === "partial_failure") return "Some steps still open";
  if (state === "failed") return "Could not complete";
  return state.replace(/_/g, " ");
}

function terminalBadgeVariant(state: string): Tone {
  if (state === "completed") return "brand";
  if (state === "partial_failure") return "warn";
  if (state === "failed") return "danger";
  return "neutral";
}

function terminalIcon(state: string): IconName {
  if (state === "completed") return "checkCircle";
  if (state === "partial_failure") return "alert";
  if (state === "failed") return "close";
  return "clock";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface SummaryCommitment {
  domain: string;
  label: string;
  partner: string;
  status: string;
}

interface SummaryAction {
  action: string;
  context: string;
  scheduled_at?: string;
}

/**
 * Full-width card for `run_summary` events, which carry structured commitment data.
 *
 * The most recent summary card (isLatest=true) starts expanded. Older ones
 * collapse to the heading line — which already carries the full story — so the
 * feed does not repeat the same five commitments for every completed run.
 * Any card can be expanded on click.
 *
 * Open/closed state is derived: an untouched card (override=null) follows isLatest,
 * so it auto-collapses when the next summary arrives and demotes it. A card the
 * user has explicitly toggled keeps their choice for the rest of the session.
 */
function SummaryCard({ ev, isLatest }: { ev: RunEvent; isLatest: boolean }) {
  // null = user has not touched this card; derive from isLatest.
  // non-null = user set an explicit preference; honour it indefinitely.
  const [override, setOverride] = useState<boolean | null>(null);
  const open = override ?? isLatest;
  const commitments = (ev.commitments ?? []) as SummaryCommitment[];
  const nextActions = (ev.next_actions ?? []) as SummaryAction[];
  const outcome = (ev.outcome ?? "completed") as string;
  const ts = formatEventTime(ev.timestamp);
  const now = useNow();

  const borderColor =
    outcome === "completed"
      ? "border-brand/25"
      : outcome === "failed"
        ? "border-danger/25"
        : "border-warn/25";
  const bgColor =
    outcome === "completed"
      ? "bg-brand-soft/30"
      : outcome === "failed"
        ? "bg-danger/[0.04]"
        : "bg-warn-soft/30";

  const hasBody = commitments.length > 0 || nextActions.length > 0;

  return (
    <li className={cx("rounded-lg border px-4 py-4", borderColor, bgColor)}>
      <div className="flex items-start gap-3">
        <Icon name="list" size={15} className="mt-0.5 shrink-0 text-brand" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[13.5px] font-semibold leading-snug text-ink">
              {String(ev.message)}
            </p>
            {hasBody && (
              <button
                type="button"
                onClick={() => setOverride((v) => !(v ?? isLatest))}
                aria-expanded={open}
                aria-label={open ? "Collapse" : "Expand"}
                className="shrink-0 rounded p-0.5 text-ink-muted transition-colors hover:text-ink"
              >
                <Icon name={open ? "chevronDown" : "chevronRight"} size={14} />
              </button>
            )}
          </div>

          {open && commitments.length > 0 && (
            <div className="mt-3 space-y-2">
              {commitments.map((c) => {
                const meta = DOMAIN_META[c.domain as Domain];
                return (
                  <div key={c.domain} className="flex flex-wrap items-center gap-2.5">
                    <Icon
                      name={meta?.icon ?? "activity"}
                      size={13}
                      className={cx("shrink-0", tone[STATUS_TONE[c.status] ?? "neutral"].text)}
                    />
                    <span className="text-[12.5px] text-ink">{c.label}</span>
                    <StatusBadge status={c.status as CommitmentStatus} />
                  </div>
                );
              })}
            </div>
          )}

          {open && nextActions.length > 0 && (
            <div className="mt-3 border-t border-line pt-3">
              <p className={type_.label}>Next steps</p>
              <ul className="mt-2 space-y-2">
                {nextActions.map((a, idx) => {
                  const when = a.scheduled_at ? formatScheduledAt(a.scheduled_at, now) : "";
                  return (
                    <li key={idx} className="flex items-start gap-2">
                      <Icon
                        name="arrowRight"
                        size={12}
                        className="mt-0.5 shrink-0 text-ink-muted"
                      />
                      <span className="text-[12.5px] leading-relaxed text-ink-soft">
                        {when ? `${a.action} ${when[0].toUpperCase() + when.slice(1)}.` : a.action}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        {ts && (
          <span
            className="mt-px shrink-0 font-mono text-[10.5px] tabular-nums text-ink-muted/70"
            title={ev.timestamp}
          >
            {ts}
          </span>
        )}
      </div>
    </li>
  );
}

/**
 * Visual divider between events from two different runs. Makes the temporal gap
 * legible: real time passed between the last event of one round and the first
 * event of the next.
 */
function RunGapMarker({
  fromTs,
  toTs,
}: {
  fromTs: string | undefined;
  toTs: string | undefined;
}) {
  const elapsed = formatElapsed(fromTs, toTs);

  return (
    <li
      className="flex items-center gap-3 py-4"
      role="separator"
      aria-label="The case waited, then checked back on its own"
    >
      <div className="h-px flex-1 bg-line" aria-hidden="true" />
      <span className="flex shrink-0 items-center gap-1.5 text-[11.5px] text-ink-muted">
        <Icon name="sleep" size={12} className="shrink-0 text-accent-deep" />
        {elapsed ? `Checked back ${elapsed} later` : "Checked back later"}
      </span>
      <div className="h-px flex-1 bg-line" aria-hidden="true" />
    </li>
  );
}

/** Shown at the foot of the feed while the case is deliberately idle. */
function DormantBanner({ nextFollowUp }: { nextFollowUp?: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-accent/25 bg-accent-soft px-4 py-4">
      <Icon name="sleep" size={18} className="mt-0.5 shrink-0 text-accent-deep" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-accent-deep">Nothing due right now</p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-soft">
          The case starts itself again when the next follow-up date arrives.
        </p>
        {nextFollowUp && (
          <p className="mt-2.5 flex items-center gap-1.5 text-[11.5px] text-ink-muted">
            <Icon name="clock" size={12} className="shrink-0" />
            Next follow-up {nextFollowUp}
          </p>
        )}
      </div>
    </div>
  );
}

function EventRow({ ev }: { ev: RunEvent }) {
  const view = describe(ev);
  const ts = formatEventTime(ev.timestamp);
  const previews =
    ev.event === "memory_recall" && Array.isArray(ev.previews) ? (ev.previews as string[]) : [];

  return (
    <li className={cx("flex items-start gap-3 rounded px-3", WEIGHT_ROW[view.weight])}>
      <Icon
        name={view.icon}
        size={WEIGHT_ICON_SIZE[view.weight]}
        className={cx(
          "mt-px shrink-0",
          view.weight === "quiet" ? "text-ink-muted" : tone[view.variant].text,
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className={WEIGHT_TEXT[view.weight]}>{view.message}</p>
          {view.status && <StatusBadge status={view.status} />}
        </div>
        {view.note && (
          <p className="mt-1 text-[12px] leading-relaxed text-ink-soft">{view.note}</p>
        )}
        {previews.length > 0 && (
          <ul className="mt-1.5 space-y-0.5">
            {previews.slice(0, 3).map((p, idx) => (
              <li key={idx} className="truncate text-[11.5px] italic text-ink-muted">
                &ldquo;{String(p)}&rdquo;
              </li>
            ))}
          </ul>
        )}
        {ev.error && <p className="mt-0.5 text-[11.5px] text-danger">{String(ev.error)}</p>}
      </div>

      {/* Timestamp: right-gutter, mono, recessive. Tabular-nums keeps the column
          from shifting as seconds tick over during streaming. */}
      {ts && (
        <span
          className="mt-px shrink-0 font-mono text-[10.5px] tabular-nums text-ink-muted/70"
          title={ev.timestamp}
        >
          {ts}
        </span>
      )}
    </li>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Memoised on `run`, which the case hands over unchanged unless the stream or
 * the recorded history actually moved. The feed is the longest thing on the
 * page and the only one a volunteer is scrolling, so a change elsewhere on the
 * case — a commitment closing, an audit line landing — must not rebuild it.
 */
export const LiveActivityFeed = memo(function LiveActivityFeed({ run }: { run: LiveRunState }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [run.events.length]);

  const isSuspended = !run.streaming && run.runStatus?.state === "suspended";

  if (run.error) {
    return (
      <Card icon="alert" title="Case Activity">
        <div className="flex items-start gap-3 rounded-control border border-danger/25 bg-danger/5 px-4 py-3">
          <Icon name="alert" size={18} className="mt-0.5 shrink-0 text-danger" />
          <div>
            <p className="text-[13px] font-medium text-danger">
              Couldn&apos;t load what has happened on this case
            </p>
            <p className={cx("mt-1", type_.small)}>{run.error}</p>
          </div>
        </div>
      </Card>
    );
  }

  // A phase that has since finished does not also need its "starting" line, so
  // each round of outreach leaves one row per provider rather than two.
  const settledPhases = new Set<string>();
  const summarisedRuns = new Set<string>();
  for (const ev of run.events) {
    if (ev.event === "phase_complete" || ev.event === "phase_error") {
      settledPhases.add(`${ev.run_id ?? ""}:${ev.phase ?? ""}`);
    }
    if (ev.event === "run_summary" && ev.run_id) {
      summarisedRuns.add(String(ev.run_id));
    }
  }

  const visibleEvents = run.events.filter((ev) => {
    if (HIDDEN_EVENTS.has(ev.event)) return false;
    // The checkpoint pair, and the completion that closes a suspended run, all
    // restate the one fact the `run_suspended` line already carries.
    if ((ev.phase ?? "").includes("checkpoint")) return false;
    if (ev.event === "run_completed" && String(ev.outcome) === "suspended") return false;
    // The awaiting_supervisor event is always followed within seconds by a
    // run_completed that carries a better explanation of why the run stopped.
    if (ev.event === "awaiting_supervisor") return false;
    // A run that emitted a summary card already said what happened — the
    // run_completed event that follows duplicates it word for word.
    if (ev.event === "run_completed" && summarisedRuns.has(String(ev.run_id))) return false;
    if (ev.event === "phase_started" && settledPhases.has(`${ev.run_id ?? ""}:${ev.phase ?? ""}`)) {
      return false;
    }
    return true;
  });

  // Find boundaries where run_id transitions — these become visual gap markers.
  const runGapIndices = new Set<number>();
  for (let i = 1; i < visibleEvents.length; i++) {
    const prev = visibleEvents[i - 1];
    const curr = visibleEvents[i];
    if (prev.run_id && curr.run_id && prev.run_id !== curr.run_id) {
      runGapIndices.add(i);
    }
  }

  // The most recent summary card stays expanded; older ones collapse to their heading.
  let lastSummaryIdx = -1;
  for (let i = visibleEvents.length - 1; i >= 0; i--) {
    if (visibleEvents[i].event === "run_summary") {
      lastSummaryIdx = i;
      break;
    }
  }

  // The suspension event carries the date of the next follow-up, so the banner
  // can name it rather than claiming one exists.
  const followUpAt = isSuspended ? nextFollowUpAt(visibleEvents) : null;
  const nextFollowUp = followUpAt === null ? undefined : formatFollowUp(followUpAt);

  const headerAction = isSuspended ? (
    <Badge variant="accent" icon="sleep">
      Waiting
    </Badge>
  ) : run.terminalState ? (
    <Badge variant={terminalBadgeVariant(run.terminalState)} icon={terminalIcon(run.terminalState)}>
      {terminalStateLabel(run.terminalState)}
    </Badge>
  ) : run.streaming ? (
    <span className="flex items-center gap-2 text-[12px] text-brand">
      <span className="inline-block size-2 animate-pulse rounded-full bg-brand" />
      Live
    </span>
  ) : undefined;

  return (
    <Card
      icon="activity"
      title="Case Activity"
      subtitle="Everything that has happened on this case, oldest first."
      action={headerAction}
    >
      {visibleEvents.length === 0 && run.streaming && (
        <div className="flex items-center gap-3 py-8">
          <span className="inline-block size-3 animate-spin rounded-full border-2 border-brand border-t-transparent" />
          <span className={type_.body}>Opening the case…</span>
        </div>
      )}

      {/* The case has been worked on — the page only shows this feed once it has
          runs — but nothing of it survives to read. Say that, rather than leaving
          a blank column that reads as nothing having happened. */}
      {visibleEvents.length === 0 && !run.streaming && (
        <EmptyState
          icon="history"
          title="No record of this case's activity."
          hint="It has been worked on before, but the account of what happened is not available to show."
        />
      )}

      {visibleEvents.length > 0 && (
        <div className="max-h-[560px] overflow-y-auto">
          <ol className="space-y-px pb-1">
            {visibleEvents.map((ev, i) => {
              const showGap = runGapIndices.has(i);
              const prevEv = showGap ? visibleEvents[i - 1] : undefined;

              return (
                <Fragment key={i}>
                  {showGap && (
                    <RunGapMarker
                      fromTs={prevEv?.timestamp}
                      toTs={ev.timestamp}
                    />
                  )}
                  {ev.event === "run_summary" ? (
                    <SummaryCard ev={ev} isLatest={i === lastSummaryIdx} />
                  ) : (
                    <EventRow ev={ev} />
                  )}
                </Fragment>
              );
            })}
          </ol>

          {run.streaming && (
            <div className="flex items-center gap-2 px-3 py-2.5">
              <span className="inline-block size-2.5 animate-spin rounded-full border-[1.5px] border-brand border-t-transparent" />
              <span className="text-[12px] text-ink-muted">Working on the case…</span>
            </div>
          )}

          <div ref={endRef} />
        </div>
      )}

      {/* Dormant state: shown instead of the terminal footer so there is no risk
          of confusing "waiting" with a failed or completed run. */}
      {isSuspended && (
        <div className={cx(visibleEvents.length > 0 && "mt-4 border-t border-line pt-4")}>
          <DormantBanner nextFollowUp={nextFollowUp} />
        </div>
      )}

      {run.runStatus?.error && !isSuspended && (
        <p className="mt-4 border-t border-line pt-4 text-[12.5px] text-danger">
          {run.runStatus.error}
        </p>
      )}
    </Card>
  );
});
