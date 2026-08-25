"use client";

import { useEffect, useRef } from "react";
import { Icon, type IconName } from "@/components/icons";
import { Badge, Card, cx } from "@/components/ui/primitives";
import { row, type as type_ } from "@/design/tokens";
import type { RunEvent } from "@/lib/api";
import type { LiveRunState } from "@/lib/live-case";

// Phase → visual treatment
function phaseIcon(event: string): { name: IconName; color: string } {
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
    case "stream_end":
      return { name: "activity", color: "text-ink-muted" };
    default:
      return { name: "activity", color: "text-ink-muted" };
  }
}

function isQuarantineEvent(ev: RunEvent): boolean {
  const phase = ev.phase ?? "";
  return phase.includes("quarantine") || (ev.message ?? "").toLowerCase().includes("quarantine");
}

function isEscalationEvent(ev: RunEvent): boolean {
  const phase = ev.phase ?? "";
  return phase.includes("approve") || (ev.message ?? "").toLowerCase().includes("escalation");
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

  return (
    <Card
      icon="activity"
      title="Agent Activity"
      subtitle={run.streaming ? "Streaming live events" : run.terminalState ? `Run ${run.terminalState.replace("_", " ")}` : undefined}
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
      {run.events.length === 0 && run.streaming && (
        <div className="flex items-center gap-3 py-6">
          <span className="inline-block size-4 animate-spin rounded-full border-2 border-brand border-t-transparent" />
          <span className={type_.body}>Waiting for events…</span>
        </div>
      )}

      {run.events.length > 0 && (
        <div className="max-h-[500px] overflow-y-auto">
          <ol className="space-y-1">
            {run.events.map((ev, i) => {
              const { name, color } = phaseIcon(ev.event);
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
                        <div className="mt-0.5 flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[11px] text-ink-muted">{ev.event}</span>
                          {ev.phase && <Badge variant="neutral">{ev.phase}</Badge>}
                          {quarantine && (
                            <Badge variant="danger" icon="lock">Quarantine</Badge>
                          )}
                          {escalation && (
                            <Badge variant="warn" icon="user">Escalation</Badge>
                          )}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[12px] font-medium text-ink">{ev.event}</span>
                          {ev.phase && <Badge variant="neutral">{ev.phase}</Badge>}
                        </div>
                        {ev.detail && <p className={cx("mt-0.5", type_.meta)}>{String(ev.detail)}</p>}
                        {ev.summary && <p className={cx("mt-0.5 line-clamp-2", type_.meta)}>{String(ev.summary)}</p>}
                      </>
                    )}
                    {ev.error && <p className="mt-0.5 text-[12px] text-danger">{ev.error}</p>}
                    {ev.failed_phases && ev.failed_phases.length > 0 && (
                      <p className="mt-0.5 text-[12px] text-warn">
                        Failed: {ev.failed_phases.join(", ")}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          {run.streaming && (
            <div className="flex items-center gap-2 px-3 py-2">
              <span className="inline-block size-3 animate-spin rounded-full border-2 border-brand border-t-transparent" />
              <span className={type_.meta}>Streaming…</span>
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
            {run.runStatus.failed_phases && run.runStatus.failed_phases.length > 0 && (
              <div>
                <dt className={type_.label}>Failed phases</dt>
                <dd className="mt-1 text-[13px] text-ink-soft">
                  {run.runStatus.failed_phases.join(", ")}
                </dd>
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
