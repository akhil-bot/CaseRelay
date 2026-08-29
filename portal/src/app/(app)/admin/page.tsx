"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge, Card, cx } from "@/components/ui/primitives";
import { control, layout, row, type as type_ } from "@/design/tokens";
import {
  createCase,
  deleteCase,
  getRunStatus,
  listScenarios,
  parseRunEventFrame,
  streamRunEvents,
  submitRun,
  type CreatedCase,
  type RunEvent,
  type RunRef,
  type RunStatus,
  type Scenario,
} from "@/lib/api";
import { useToolEvents, type ToolEventCallbacks } from "@/lib/copilot/tool-events";

type Phase = "pick" | "created" | "streaming" | "done";

export default function AdminPage() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Read before the create handler is declared, because that handler publishes
  // into the registry: a case made by clicking here has to be referable by name
  // in the chat afterwards, the same as one the chat made itself.
  const { subscribe, pushCase } = useToolEvents();

  useEffect(() => {
    listScenarios()
      .then(setScenarios)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const [phase, setPhase] = useState<Phase>("pick");
  const [selectedScenario, setSelectedScenario] = useState<Scenario | null>(null);
  const [createdCase, setCreatedCase] = useState<CreatedCase | null>(null);
  const [runStatus, setRunStatus] = useState<RunStatus | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [starting, setStarting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [dueIn, setDueIn] = useState("10s");
  const esRef = useRef<EventSource | null>(null);

  const reset = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
    setPhase("pick");
    setSelectedScenario(null);
    setCreatedCase(null);
    setRunStatus(null);
    setEvents([]);
    setStreamError(null);
    setCreating(false);
    setStarting(false);
    setDeleting(false);
  }, []);

  const handleCreate = useCallback(
    async (scenario: Scenario) => {
      setSelectedScenario(scenario);
      setCreating(true);
      setError(null);
      try {
        const result = await createCase(scenario.id, dueIn || undefined);
        setCreatedCase(result);
        setPhase("created");
        // `start_outreach` resolves a case only through this registry, so
        // without this the case exists on the control plane but the chat cannot
        // name it — "run it" would answer that no case was created.
        pushCase({
          caseId: result.case_id,
          scenario: scenario.id,
          childName: scenario.child_name,
        });
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setCreating(false);
      }
    },
    [dueIn, pushCase],
  );

  const startEventStream = useCallback((runId: string) => {
    setPhase("streaming");
    setEvents([]);

    const es = streamRunEvents(runId);
    esRef.current = es;

    es.onmessage = (msg) => {
      const ev = parseRunEventFrame(msg.data);
      if (!ev) return;
      setEvents((prev) => [...prev, ev]);
      if (ev.event === "stream_end" || ev.event === "stream_timeout") {
        es.close();
        esRef.current = null;
        getRunStatus(runId).then((status) => {
          setRunStatus(status);
          setPhase("done");
        });
      }
    };

    es.onerror = () => {
      es.close();
      esRef.current = null;
      getRunStatus(runId)
        .then((status) => {
          setRunStatus(status);
          setPhase("done");
        })
        .catch((err) => setStreamError(err instanceof Error ? err.message : String(err)));
    };
  }, []);

  const handleRun = useCallback(async () => {
    if (!createdCase) return;
    setStarting(true);
    setStreamError(null);
    try {
      const ref = await submitRun(createdCase.case_id);
      setRunStatus({ run_id: ref.run_id, state: "queued" } as RunStatus);
      startEventStream(ref.run_id);
    } catch (err: unknown) {
      setStreamError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  }, [createdCase, startEventStream]);

  const copilotCallbacks = useMemo<ToolEventCallbacks>(
    () => ({
      onCaseCreated: (result: CreatedCase, scenario: Scenario) => {
        setSelectedScenario(scenario);
        setCreatedCase(result);
        setPhase("created");
        setError(null);
      },
      onRunStarted: (ref: RunRef, caseId: string) => {
        setRunStatus({ run_id: ref.run_id, state: "queued" } as RunStatus);
        if (!createdCase || createdCase.case_id !== caseId) {
          setCreatedCase({ case_id: caseId, scenario: "", due_at: "", summary: "" });
        }
        setStreamError(null);
        startEventStream(ref.run_id);
      },
    }),
    [createdCase, startEventStream],
  );

  useEffect(() => subscribe(copilotCallbacks), [subscribe, copilotCallbacks]);

  const handleDelete = useCallback(async () => {
    if (!createdCase) return;
    setDeleting(true);
    try {
      await deleteCase(createdCase.case_id);
      reset();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  }, [createdCase, reset]);

  useEffect(() => {
    return () => {
      esRef.current?.close();
    };
  }, []);

  if (loading) {
    return (
      <Card icon="settings" title="Synthetic Data Lab">
        <p className={type_.body}>Loading scenarios…</p>
      </Card>
    );
  }

  if (error && phase === "pick" && scenarios.length === 0) {
    return (
      <Card icon="settings" title="Synthetic Data Lab">
        <div className="flex items-start gap-3 rounded-control border border-danger/25 bg-danger/5 px-4 py-3">
          <Icon name="alert" size={18} className="mt-0.5 shrink-0 text-danger" />
          <div>
            <p className="text-[13px] font-medium text-danger">Failed to load scenarios</p>
            <p className={cx("mt-1", type_.small)}>{error}</p>
          </div>
        </div>
      </Card>
    );
  }

  const simple = scenarios.filter((s) => s.complexity === "simple");
  const complex = scenarios.filter((s) => s.complexity === "complex");

  return (
    <div className={layout.stack}>
      {/* Scenario picker */}
      {phase === "pick" && (
        <Card
          icon="settings"
          title="Synthetic Data Lab"
          subtitle="Create a test case from a scenario, run the agent fleet, and watch live events."
          action={
            <label className="flex items-center gap-2 text-[12.5px] text-ink-soft">
              <span>Deadline:</span>
              <input
                type="text"
                value={dueIn}
                onChange={(e) => setDueIn(e.target.value)}
                placeholder="e.g. 10s or 17d"
                className="w-20 rounded-control border border-line bg-surface-soft px-2 py-1.5 text-[12px] text-ink focus:border-brand/40 focus:outline-none"
              />
            </label>
          }
        >
          {error && (
            <div className="mb-4 flex items-start gap-3 rounded-control border border-danger/25 bg-danger/5 px-4 py-3">
              <Icon name="alert" size={18} className="mt-0.5 shrink-0 text-danger" />
              <p className={type_.small}>{error}</p>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <ScenarioColumn title="Simple" scenarios={simple} onPick={handleCreate} disabled={creating} />
            <ScenarioColumn title="Complex" scenarios={complex} onPick={handleCreate} disabled={creating} />
          </div>
        </Card>
      )}

      {/* Case created — ready to run */}
      {phase === "created" && createdCase && selectedScenario && (
        <Card icon="cases" title={`Case ${createdCase.case_id}`} subtitle={`Scenario: ${selectedScenario.title}`}>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="Case ID" value={createdCase.case_id} mono />
            <Fact label="Scenario" value={createdCase.scenario} />
            <Fact label="Due at" value={new Date(createdCase.due_at).toLocaleString()} />
            <Fact label="Status" value="Ready to run" />
          </dl>
          <div className="mt-5 flex items-center gap-3 border-t border-line pt-4">
            <button type="button" onClick={handleRun} disabled={starting} className={control.primary}>
              <Icon name="play" size={15} />
              {starting ? "Starting…" : "Run the fleet"}
            </button>
            <button type="button" onClick={handleDelete} disabled={deleting} className={control.secondary}>
              <Icon name="close" size={15} />
              Delete case
            </button>
            <button type="button" onClick={reset} className={control.ghost}>
              Start over
            </button>
          </div>
        </Card>
      )}

      {/* Streaming / done */}
      {(phase === "streaming" || phase === "done") && (
        <>
          <Card
            icon="activity"
            title="Run Events"
            subtitle={runStatus ? `Run ${runStatus.run_id}` : undefined}
            action={<RunStateBadge state={runStatus?.state ?? "queued"} />}
          >
            {streamError && (
              <div className="mb-4 flex items-start gap-3 rounded-control border border-danger/25 bg-danger/5 px-4 py-3">
                <Icon name="alert" size={18} className="mt-0.5 shrink-0 text-danger" />
                <p className={type_.small}>{streamError}</p>
              </div>
            )}
            <EventLog events={events} streaming={phase === "streaming"} />
          </Card>

          {phase === "done" && runStatus && (
            <Card
              icon={runStatus.state === "completed" ? "checkCircle" : runStatus.state === "failed" ? "close" : "alert"}
              title={
                runStatus.state === "completed"
                  ? "Run Complete"
                  : runStatus.state === "partial_failure"
                    ? "Run Partial Failure"
                    : "Run Failed"
              }
            >
              <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Fact label="Final state" value={runStatus.state} />
                {runStatus.error && <Fact label="Error" value={runStatus.error} />}
                {runStatus.failed_phases && runStatus.failed_phases.length > 0 && (
                  <Fact label="Failed phases" value={runStatus.failed_phases.join(", ")} />
                )}
                {runStatus.trace_id && <Fact label="Trace ID" value={runStatus.trace_id} mono />}
              </dl>
              <div className="mt-5 flex items-center gap-3 border-t border-line pt-4">
                <button type="button" onClick={handleDelete} disabled={deleting} className={control.secondary}>
                  <Icon name="close" size={15} />
                  Delete case
                </button>
                <button type="button" onClick={reset} className={control.primary}>
                  <Icon name="plus" size={15} />
                  New test
                </button>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function ScenarioColumn({
  title,
  scenarios,
  onPick,
  disabled,
}: {
  title: string;
  scenarios: Scenario[];
  onPick: (s: Scenario) => void;
  disabled: boolean;
}) {
  return (
    <div>
      <h3 className={cx("mb-3", type_.label)}>{title}</h3>
      <ul className="space-y-2">
        {scenarios.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick(s)}
              className={cx(
                "w-full rounded-control border px-4 py-3 text-left transition-colors",
                "border-line hover:border-brand/30 hover:bg-brand-soft/30 disabled:opacity-50",
              )}
            >
              <div className="flex items-center gap-2">
                <span className="text-[13.5px] font-semibold text-ink">{s.child_name}</span>
                <Badge variant={s.complexity === "complex" ? "accent" : "neutral"}>{s.complexity}</Badge>
              </div>
              <p className="mt-1 text-[12.5px] font-medium text-ink-soft">{s.title}</p>
              <p className={cx("mt-1", type_.meta)}>{s.expected_outcome}</p>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className={type_.label}>{label}</dt>
      <dd className={cx("mt-1 text-[13px]", mono ? "font-mono text-[12px] text-ink-soft break-all" : "text-ink")}>
        {value}
      </dd>
    </div>
  );
}

function RunStateBadge({ state }: { state: string }) {
  const variant =
    state === "completed"
      ? "brand"
      : state === "partial_failure"
        ? "warn"
        : state === "failed"
          ? "danger"
          : "neutral";
  const icon =
    state === "completed"
      ? "check"
      : state === "partial_failure"
        ? "alert"
        : state === "failed"
          ? "close"
          : state === "running"
            ? "activity"
            : "clock";
  return (
    <Badge variant={variant as "brand" | "warn" | "danger" | "neutral"} icon={icon as "check" | "alert" | "close" | "activity" | "clock"}>
      {state}
    </Badge>
  );
}

const _HIDDEN_ADMIN_EVENTS = new Set(["connected", "stream_end", "stream_timeout"]);

function _isQuarantine(ev: RunEvent): boolean {
  return (ev.phase ?? "").includes("quarantine");
}

function _isEscalation(ev: RunEvent): boolean {
  return (ev.phase ?? "").includes("approve");
}

function _isMemory(ev: RunEvent): boolean {
  return ev.event === "memory_recall" || ev.event === "memory_write";
}

interface AdminSummaryCommitment {
  domain: string;
  label: string;
  partner: string;
  status: string;
}

interface AdminSummaryAction {
  action: string;
  context: string;
}

function _statusVariant(status: string): "brand" | "warn" | "danger" | "neutral" {
  if (status === "completed") return "brand";
  if (status === "blocked") return "danger";
  if (status === "unresolved") return "warn";
  return "neutral";
}

function AdminSummaryCard({ ev }: { ev: RunEvent }) {
  const commitments = (ev.commitments ?? []) as AdminSummaryCommitment[];
  const nextActions = (ev.next_actions ?? []) as AdminSummaryAction[];
  const outcome = (ev.outcome ?? "completed") as string;

  const borderColor =
    outcome === "completed" ? "border-brand/25" :
    outcome === "failed" ? "border-danger/25" : "border-warn/25";
  const bgColor =
    outcome === "completed" ? "bg-brand-soft/20" :
    outcome === "failed" ? "bg-danger/5" : "bg-warn-soft/20";

  return (
    <li className={cx("rounded-lg border px-4 py-4", borderColor, bgColor)}>
      <p className="text-[14px] font-semibold leading-relaxed text-ink">
        {String(ev.message)}
      </p>
      {commitments.length > 0 && (
        <div className="mt-3 space-y-1">
          {commitments.map((c) => (
            <div key={c.domain} className="flex items-center gap-2">
              <span className="text-[13px] text-ink">{c.label}</span>
              <Badge variant={_statusVariant(c.status)}>{c.status}</Badge>
            </div>
          ))}
        </div>
      )}
      {nextActions.length > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          <p className="text-[11px] font-medium tracking-[0.08em] text-ink-muted uppercase">What to do next</p>
          <ul className="mt-1.5 space-y-1">
            {nextActions.map((a, idx) => (
              <li key={idx} className="text-[13px] text-ink">{a.action}</li>
            ))}
          </ul>
        </div>
      )}
      {ev.memory != null && (() => {
        const mem = ev.memory as { recalled: number; wrote: boolean };
        const parts: string[] = [];
        if (mem.recalled > 0) parts.push(`Recalled ${mem.recalled} note${mem.recalled !== 1 ? "s" : ""} from earlier work`);
        if (mem.wrote) parts.push("Saved notes for next time");
        if (parts.length === 0) return null;
        return (
          <div className="mt-3 flex items-center gap-2 border-t border-line pt-3 text-[12px] text-ink-muted">
            <Icon name="memory" size={13} className="shrink-0 text-accent" />
            <span>{parts.join(" · ")}</span>
          </div>
        );
      })()}
    </li>
  );
}

function EventLog({ events, streaming }: { events: RunEvent[]; streaming: boolean }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length]);

  const visible = events.filter((ev) => !_HIDDEN_ADMIN_EVENTS.has(ev.event));

  if (visible.length === 0 && streaming) {
    return (
      <div className="flex items-center gap-3 py-6">
        <span className="inline-block size-4 animate-spin rounded-full border-2 border-brand border-t-transparent" />
        <span className={type_.body}>Waiting for events…</span>
      </div>
    );
  }

  return (
    <div className="max-h-[400px] overflow-y-auto">
      <ol className="space-y-1">
        {visible.map((ev, i) => {
          if (ev.event === "run_summary") {
            return <AdminSummaryCard key={i} ev={ev} />;
          }

          const quarantine = _isQuarantine(ev);
          const escalation = _isEscalation(ev);
          const memory = _isMemory(ev);
          const highlight = quarantine || escalation || memory;

          return (
            <li
              key={i}
              className={cx(
                "flex items-start gap-3 rounded px-3 py-2",
                highlight
                  ? quarantine
                    ? "border-l-2 border-l-danger bg-danger/5"
                    : escalation
                      ? "border-l-2 border-l-warn bg-warn-soft/50"
                      : "border-l-2 border-l-accent/30 bg-accent-soft/20"
                  : row.hover,
              )}
            >
              <EventIcon event={ev.event} />
              <div className="min-w-0 flex-1">
                {ev.message ? (
                  <>
                    <p className={cx(
                      "text-[13px] leading-relaxed",
                      highlight ? "font-medium text-ink" : "text-ink",
                    )}>
                      {String(ev.message)}
                    </p>
                    {(quarantine || escalation || memory) && (
                      <div className="mt-0.5 flex flex-wrap items-center gap-2">
                        {quarantine && <Badge variant="danger" icon="shield">Flagged for review</Badge>}
                        {escalation && <Badge variant="warn" icon="user">Supervisor review</Badge>}
                        {memory && (
                          <Badge variant="accent" icon="memory">
                            {ev.event === "memory_recall" ? "Remembered" : "Saved"}
                          </Badge>
                        )}
                      </div>
                    )}
                    {ev.event === "memory_recall" && Array.isArray(ev.previews) && ev.previews.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5">
                        {(ev.previews as string[]).slice(0, 3).map((p, idx) => (
                          <li key={idx} className="truncate text-[12px] italic text-ink-muted">
                            &ldquo;{String(p)}&rdquo;
                          </li>
                        ))}
                      </ul>
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
      {streaming && (
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="inline-block size-3 animate-spin rounded-full border-2 border-brand border-t-transparent" />
          <span className={type_.meta}>Working…</span>
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}

function EventIcon({ event }: { event: string }) {
  const name =
    event === "run_started"
      ? "play"
      : event === "phase_started"
        ? "arrowRight"
        : event === "phase_complete"
          ? "check"
          : event === "phase_error"
            ? "alert"
            : event === "run_completed"
              ? "checkCircle"
              : event === "run_partial_failure"
                ? "alert"
                : event === "run_failed"
                  ? "close"
                  : event === "run_summary"
                    ? "list"
                    : event === "memory_recall" || event === "memory_write"
                      ? "memory"
                      : "activity";
  const color =
    event === "run_failed" || event === "phase_error"
      ? "text-danger"
      : event === "run_partial_failure"
        ? "text-warn"
        : event === "run_completed" || event === "phase_complete"
          ? "text-brand"
          : event === "memory_recall" || event === "memory_write"
            ? "text-accent-deep"
            : "text-ink-muted";
  return <Icon name={name as "play"} size={16} className={cx("mt-0.5 shrink-0", color)} />;
}
