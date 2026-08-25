"use client";

import { useEffect, useRef } from "react";
import { Icon, type IconName } from "@/components/icons";
import { Badge, Card, cx } from "@/components/ui/primitives";
import { row, type as type_ } from "@/design/tokens";
import type { RunEvent } from "@/lib/api";
import type { LiveRunState } from "@/lib/live-case";

const _HIDDEN_EVENTS = new Set(["connected", "stream_end", "stream_timeout"]);

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
    default:
      return { name: "activity", color: "text-ink-muted" };
  }
}

function isQuarantineEvent(ev: RunEvent): boolean {
  const phase = ev.phase ?? "";
  return phase.includes("quarantine");
}

function isEscalationEvent(ev: RunEvent): boolean {
  const phase = ev.phase ?? "";
  return phase.includes("approve");
}

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

function SummaryCard({ ev }: { ev: RunEvent }) {
  const commitments = (ev.commitments ?? []) as SummaryCommitment[];
  const nextActions = (ev.next_actions ?? []) as SummaryAction[];
  const outcome = (ev.outcome ?? "completed") as string;

  const borderColor =
    outcome === "completed" ? "border-brand/25" :
    outcome === "failed" ? "border-danger/25" : "border-warn/25";
  const bgColor =
    outcome === "completed" ? "bg-brand-soft/20" :
    outcome === "failed" ? "bg-danger/5" : "bg-warn-soft/20";

  return (
    <li className={cx("rounded-lg border px-4 py-4", borderColor, bgColor)}>
      <div className="flex items-start gap-3">
        <Icon name="list" size={18} className="mt-0.5 shrink-0 text-brand" />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold leading-relaxed text-ink">
            {String(ev.message)}
          </p>

          {commitments.length > 0 && (
            <div className="mt-3 space-y-1.5">
              {commitments.map((c) => (
                <div key={c.domain} className="flex items-center gap-2">
                  <Icon name={statusIcon(c.status)} size={14} className={cx("shrink-0", `text-${statusVariant(c.status) === "brand" ? "brand" : statusVariant(c.status) === "danger" ? "danger" : statusVariant(c.status) === "warn" ? "warn" : "ink-muted"}`)} />
                  <span className="text-[13px] text-ink">{c.label}</span>
                  <Badge variant={statusVariant(c.status)}>
                    {c.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}

          {nextActions.length > 0 && (
            <div className="mt-3 border-t border-line pt-3">
              <p className={type_.label}>What to do next</p>
              <ul className="mt-1.5 space-y-1.5">
                {nextActions.map((a, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <Icon name="arrowRight" size={13} className="mt-0.5 shrink-0 text-ink-muted" />
                    <span className="text-[13px] leading-relaxed text-ink">{a.action}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

export function LiveActivityFeed({ run }: { run: LiveRunState }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [run.events.length]);

  if (run.error) {
    return (
      <Card icon="alert" title="Event Stream Error">
        <div className="flex items-start gap-3 rounded-control border border-danger/25 bg-danger/5 px-4 py-3">
          <Icon name="alert" size={18} className="mt-0.5 shrink-0 text-danger" />
          <div>
            <p className="text-[13px] font-medium text-danger">Failed to connect to event stream</p>
            <p className={cx("mt-1", type_.small)}>{run.error}</p>
          </div>
        </div>
      </Card>
    );
  }

  const visibleEvents = run.events.filter((ev) => !_HIDDEN_EVENTS.has(ev.event));

  return (
    <Card
      icon="activity"
      title="Agent Activity"
      subtitle={run.streaming ? "Working on the case…" : run.terminalState ? `Run ${run.terminalState.replace("_", " ")}` : undefined}
      action={
        run.terminalState ? (
          <Badge
            variant={terminalBadgeVariant(run.terminalState)}
            icon={terminalIcon(run.terminalState)}
          >
            {run.terminalState.replace("_", " ")}
          </Badge>
        ) : run.streaming ? (
          <span className="flex items-center gap-2 text-[12px] text-brand">
            <span className="inline-block size-2 animate-pulse rounded-full bg-brand" />
            Live
          </span>
        ) : undefined
      }
    >
      {visibleEvents.length === 0 && run.streaming && (
        <div className="flex items-center gap-3 py-6">
          <span className="inline-block size-4 animate-spin rounded-full border-2 border-brand border-t-transparent" />
          <span className={type_.body}>Waiting for events…</span>
        </div>
      )}

      {visibleEvents.length > 0 && (
        <div className="max-h-[500px] overflow-y-auto">
          <ol className="space-y-1">
            {visibleEvents.map((ev, i) => {
              if (ev.event === "run_summary") {
                return <SummaryCard key={i} ev={ev} />;
              }

              const { name, color } = eventIcon(ev.event);
              const quarantine = isQuarantineEvent(ev);
              const escalation = isEscalationEvent(ev);
              const highlight = quarantine || escalation;

              return (
                <li
                  key={i}
                  className={cx(
                    "flex items-start gap-3 rounded px-3 py-2",
                    highlight
                      ? quarantine
                        ? "border-l-2 border-l-danger bg-danger/5"
                        : "border-l-2 border-l-warn bg-warn-soft/50"
                      : row.hover,
                  )}
                >
                  <Icon name={name} size={16} className={cx("mt-0.5 shrink-0", color)} />
                  <div className="min-w-0 flex-1">
                    {ev.message ? (
                      <>
                        <p className={cx(
                          "text-[13px] leading-relaxed",
                          highlight ? "font-medium text-ink" : "text-ink",
                        )}>
                          {String(ev.message)}
                        </p>
                        {(quarantine || escalation) && (
                          <div className="mt-0.5 flex flex-wrap items-center gap-2">
                            {quarantine && (
                              <Badge variant="danger" icon="shield">Flagged for review</Badge>
                            )}
                            {escalation && (
                              <Badge variant="warn" icon="user">Supervisor review</Badge>
                            )}
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="text-[13px] text-ink-soft">Processing…</p>
                    )}
                    {ev.error && <p className="mt-0.5 text-[12px] text-danger">{ev.error}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
          {run.streaming && (
            <div className="flex items-center gap-2 px-3 py-2">
              <span className="inline-block size-3 animate-spin rounded-full border-2 border-brand border-t-transparent" />
              <span className={type_.meta}>Working…</span>
            </div>
          )}
          <div ref={endRef} />
        </div>
      )}

      {run.runStatus && (
        <div className="mt-4 border-t border-line pt-4">
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className={type_.label}>Final state</dt>
              <dd className="mt-1 text-[13px] text-ink">{run.runStatus.state}</dd>
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
