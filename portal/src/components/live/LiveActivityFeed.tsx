"use client";

import { Fragment, useEffect, useRef } from "react";
import { Icon, type IconName } from "@/components/icons";
import { Badge, Card, cx } from "@/components/ui/primitives";
import { row, type as type_ } from "@/design/tokens";
import type { RunEvent } from "@/lib/api";
import type { LiveRunState } from "@/lib/live-case";

const _HIDDEN_EVENTS = new Set(["connected", "stream_end", "stream_timeout"]);

// ─── Icon mapping ─────────────────────────────────────────────────────────────

function eventIcon(event: string): { name: IconName; color: string } {
  switch (event) {
    case "run_started":
      return { name: "play", color: "text-brand" };
    case "phase_started":
      return { name: "arrowRight", color: "text-ink-muted" };
    case "phase_complete":
      return { name: "check", color: "text-brand" };
    case "phase_error":
      return { name: "alert", color: "text-danger" };
    case "run_completed":
      return { name: "checkCircle", color: "text-brand" };
    case "run_partial_failure":
      return { name: "alert", color: "text-warn" };
    case "run_failed":
      return { name: "close", color: "text-danger" };
    case "run_summary":
      return { name: "list", color: "text-brand" };
    case "memory_recall":
    case "memory_write":
      return { name: "memory", color: "text-accent-deep" };
    case "wake_scheduled":
      return { name: "sleep", color: "text-accent-deep" };
    case "wake_fired":
      return { name: "play", color: "text-accent" };
    default:
      return { name: "activity", color: "text-ink-muted" };
  }
}

// ─── Significance ─────────────────────────────────────────────────────────────

type Significance = "routine" | "notable" | "critical";

/**
 * Grades each event so visual weight follows importance rather than decoration.
 * Quarantine and errors are critical. Approvals, completions, and wake events are
 * notable. Everything else (progress ticks, memory operations) is routine.
 */
function getSignificance(ev: RunEvent): Significance {
  const phase = ev.phase ?? "";
  const event = ev.event;
  if (
    phase.includes("quarantine") ||
    event === "phase_error" ||
    event === "run_failed"
  )
    return "critical";
  if (
    phase.includes("approve") ||
    event === "run_completed" ||
    event === "run_partial_failure" ||
    event === "run_summary" ||
    event === "wake_fired"
  )
    return "notable";
  return "routine";
}

function isMemoryEvent(ev: RunEvent): boolean {
  return ev.event === "memory_recall" || ev.event === "memory_write";
}

// ─── Time helpers ─────────────────────────────────────────────────────────────

function formatEventTime(ts: string | undefined): string {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

function formatElapsed(fromTs: string | undefined, toTs: string | undefined): string {
  if (!fromTs || !toTs) return "";
  try {
    const diff = Math.abs(new Date(toTs).getTime() - new Date(fromTs).getTime());
    const secs = Math.round(diff / 1000);
    if (secs < 60) return `${secs}s`;
    const mins = Math.round(secs / 60);
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins / 60)}h\u202f${mins % 60}m`;
  } catch {
    return "";
  }
}

// ─── Badge/icon helpers (terminal and commitment) ─────────────────────────────

function terminalBadgeVariant(state: string): "brand" | "warn" | "danger" | "neutral" {
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

function statusVariant(status: string): "brand" | "warn" | "danger" | "neutral" {
  if (status === "completed") return "brand";
  if (status === "blocked") return "danger";
  if (status === "unresolved") return "warn";
  return "neutral";
}

function statusIcon(status: string): IconName {
  if (status === "completed") return "check";
  if (status === "blocked") return "lock";
  if (status === "unresolved") return "alert";
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
}

/** Full-width card for `run_summary` events, which carry structured commitment data. */
function SummaryCard({ ev }: { ev: RunEvent }) {
  const commitments = (ev.commitments ?? []) as SummaryCommitment[];
  const nextActions = (ev.next_actions ?? []) as SummaryAction[];
  const outcome = (ev.outcome ?? "completed") as string;
  const ts = formatEventTime(ev.timestamp);

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

  return (
    <li className={cx("rounded-lg border px-4 py-4", borderColor, bgColor)}>
      <div className="flex items-start gap-3">
        <Icon name="list" size={15} className="mt-0.5 shrink-0 text-brand" />
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold leading-snug text-ink">
            {String(ev.message)}
          </p>

          {commitments.length > 0 && (
            <div className="mt-3 space-y-2">
              {commitments.map((c) => (
                <div key={c.domain} className="flex items-center gap-2.5">
                  <Icon
                    name={statusIcon(c.status)}
                    size={13}
                    className={cx(
                      "shrink-0",
                      statusVariant(c.status) === "brand"
                        ? "text-brand"
                        : statusVariant(c.status) === "danger"
                          ? "text-danger"
                          : statusVariant(c.status) === "warn"
                            ? "text-warn"
                            : "text-ink-muted",
                    )}
                  />
                  <span className="text-[12.5px] text-ink">{c.label}</span>
                  <Badge variant={statusVariant(c.status)}>{c.status}</Badge>
                </div>
              ))}
            </div>
          )}

          {nextActions.length > 0 && (
            <div className="mt-3 border-t border-line pt-3">
              <p className={type_.label}>Next steps</p>
              <ul className="mt-2 space-y-2">
                {nextActions.map((a, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <Icon
                      name="arrowRight"
                      size={12}
                      className="mt-0.5 shrink-0 text-ink-muted"
                    />
                    <span className="text-[12.5px] leading-relaxed text-ink-soft">
                      {a.action}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {ev.memory != null &&
            (() => {
              const mem = ev.memory as { recalled: number; wrote: boolean };
              const parts: string[] = [];
              if (mem.recalled > 0)
                parts.push(
                  `Recalled ${mem.recalled} note${mem.recalled !== 1 ? "s" : ""} from earlier work`,
                );
              if (mem.wrote) parts.push("Saved notes for next time");
              if (parts.length === 0) return null;
              return (
                <p className="mt-3 flex items-center gap-1.5 border-t border-line pt-3 text-[11.5px] text-ink-muted">
                  <Icon name="memory" size={12} className="shrink-0 text-accent" />
                  {parts.join(" · ")}
                </p>
              );
            })()}
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
 * Visual divider between events from two different runs.
 * Makes the temporal gap legible: a judge can see that real time passed between
 * the last event of run 1 and the first event of run 2.
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
      aria-label="Case was waiting on follow-up between rounds of outreach"
    >
      <div className="h-px flex-1 bg-line" aria-hidden="true" />
      <span className="flex shrink-0 items-center gap-1.5 text-[11.5px] text-ink-muted">
        <Icon name="sleep" size={12} className="shrink-0 text-accent-deep" />
        {elapsed ? `waiting on follow-up\u202f·\u202f${elapsed}` : "checked back"}
        {" — checked back automatically"}
      </span>
      <div className="h-px flex-1 bg-line" aria-hidden="true" />
    </li>
  );
}

/**
 * Shown at the bottom of the feed when the run state is "suspended".
 * Communicates that the system is deliberately idle, not broken, and that
 * resumption is automatic — the key claim for the multi-week async operation story.
 */
function DormantBanner({ wakeScheduledAt }: { wakeScheduledAt?: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-accent/25 bg-accent-soft px-4 py-4">
      <Icon name="sleep" size={18} className="mt-0.5 shrink-0 text-accent-deep" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-accent-deep">
          Waiting on follow-up — checking back automatically
        </p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-soft">
          Outreach has been sent to all service providers. CaseRelay is watching
          the follow-up dates and will check back automatically — no one needs to
          remember to do it.
        </p>
        {wakeScheduledAt && (
          <p className="mt-2.5 flex items-center gap-1.5 text-[11.5px] text-ink-muted">
            <Icon name="clock" size={12} className="shrink-0" />
            Follow-up scheduled for{" "}
            <span className="font-mono tabular-nums">{wakeScheduledAt}</span>
          </p>
        )}
      </div>
    </div>
  );
}

/** One event row. Visual weight is determined by significance; badges are used only in the summary card. */
function EventRow({ ev }: { ev: RunEvent }) {
  const sig = getSignificance(ev);
  const mem = isMemoryEvent(ev);
  const quarantine = (ev.phase ?? "").includes("quarantine");
  const escalation = (ev.phase ?? "").includes("approve");
  const { name, color } = eventIcon(ev.event);
  const ts = formatEventTime(ev.timestamp);

  // Outer container — left border and background only for the two genuinely high-stakes
  // categories (quarantine, escalation). Memory and notable events carry weight via
  // typography alone, keeping the border device rare and therefore meaningful.
  const outerCls = cx(
    "flex items-start gap-3 rounded px-3",
    quarantine
      ? "border-l-2 border-l-danger bg-danger/[0.04] py-3"
      : escalation
        ? "border-l-2 border-l-warn bg-warn-soft/35 py-3"
        : sig === "notable"
          ? "py-2.5"
          : mem
            ? "bg-accent-soft/10 py-2"
            : cx("py-2", row.hover),
  );

  // Message typography — weight and colour do the work, not chips or borders.
  const msgCls = cx(
    "leading-relaxed",
    quarantine || escalation
      ? "text-[13px] font-semibold text-ink"
      : sig === "notable"
        ? "text-[13px] font-medium text-ink"
        : "text-[12.5px] text-ink-soft",
  );

  return (
    <li className={outerCls}>
      <Icon
        name={name}
        size={sig !== "routine" ? 15 : 14}
        className={cx("mt-px shrink-0", color)}
      />
      <div className="min-w-0 flex-1">
        {ev.message ? (
          <>
            <p className={msgCls}>{String(ev.message)}</p>
            {mem &&
              ev.event === "memory_recall" &&
              Array.isArray(ev.previews) &&
              ev.previews.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {(ev.previews as string[]).slice(0, 3).map((p, idx) => (
                    <li key={idx} className="truncate text-[11.5px] italic text-ink-muted">
                      &ldquo;{String(p)}&rdquo;
                    </li>
                  ))}
                </ul>
              )}
          </>
        ) : (
          <p className="text-[12.5px] text-ink-muted">—</p>
        )}
        {ev.error && (
          <p className="mt-0.5 text-[11.5px] text-danger">{ev.error}</p>
        )}
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

export function LiveActivityFeed({ run }: { run: LiveRunState }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [run.events.length]);

  const isSuspended = !run.streaming && run.runStatus?.state === "suspended";

  if (run.error) {
    return (
      <Card icon="alert" title="Event Stream Error">
        <div className="flex items-start gap-3 rounded-control border border-danger/25 bg-danger/5 px-4 py-3">
          <Icon name="alert" size={18} className="mt-0.5 shrink-0 text-danger" />
          <div>
            <p className="text-[13px] font-medium text-danger">
              Failed to connect to event stream
            </p>
            <p className={cx("mt-1", type_.small)}>{run.error}</p>
          </div>
        </div>
      </Card>
    );
  }

  const visibleEvents = run.events.filter((ev) => !_HIDDEN_EVENTS.has(ev.event));

  // Find boundaries where run_id transitions — these become visual gap markers.
  const runGapIndices = new Set<number>();
  for (let i = 1; i < visibleEvents.length; i++) {
    const prev = visibleEvents[i - 1];
    const curr = visibleEvents[i];
    if (prev.run_id && curr.run_id && prev.run_id !== curr.run_id) {
      runGapIndices.add(i);
    }
  }

  // When suspended, surface the latest scheduled wake time in the dormant banner.
  const wakeScheduledEv = isSuspended
    ? [...visibleEvents].reverse().find((ev) => ev.event === "wake_scheduled")
    : undefined;
  const wakeScheduledAt = wakeScheduledEv?.timestamp
    ? formatEventTime(wakeScheduledEv.timestamp)
    : undefined;

  function terminalStateLabel(state: string): string {
    if (state === "completed") return "All steps complete";
    if (state === "partial_failure") return "Some steps still open";
    if (state === "failed") return "Could not complete";
    return state.replace(/_/g, " ");
  }

  const headerSubtitle = run.streaming
    ? "Working on the case…"
    : isSuspended
      ? "Waiting on follow-up — will check back automatically"
      : run.terminalState
        ? terminalStateLabel(run.terminalState)
        : undefined;

  const headerAction = run.terminalState ? (
    <Badge variant={terminalBadgeVariant(run.terminalState)} icon={terminalIcon(run.terminalState)}>
      {terminalStateLabel(run.terminalState)}
    </Badge>
  ) : isSuspended ? (
    <Badge variant="accent" icon="sleep">
      Waiting
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
      subtitle={headerSubtitle}
      action={headerAction}
    >
      {visibleEvents.length === 0 && run.streaming && (
        <div className="flex items-center gap-3 py-8">
          <span className="inline-block size-3 animate-spin rounded-full border-2 border-brand border-t-transparent" />
          <span className={type_.body}>Connecting to event stream…</span>
        </div>
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
                    <SummaryCard ev={ev} />
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
          of confusing "suspended" with a failed or completed run. */}
      {isSuspended && (
        <div className={cx(visibleEvents.length > 0 && "mt-4 border-t border-line pt-4")}>
          <DormantBanner wakeScheduledAt={wakeScheduledAt} />
        </div>
      )}

      {run.runStatus && !isSuspended && (
        <div className="mt-4 border-t border-line pt-4">
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className={type_.label}>Outcome</dt>
              <dd className="mt-1 text-[13px] text-ink">{terminalStateLabel(run.runStatus.state)}</dd>
            </div>
            {run.runStatus.error && (
              <div>
                <dt className={type_.label}>Error</dt>
                <dd className="mt-1 text-[13px] text-danger">{run.runStatus.error}</dd>
              </div>
            )}
            {run.runStatus.trace_id && (
              <div>
                <dt className={type_.label}>Trace ID</dt>
                <dd className="mt-1 break-all font-mono text-[12px] text-ink-soft">
                  {run.runStatus.trace_id}
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}
    </Card>
  );
}
