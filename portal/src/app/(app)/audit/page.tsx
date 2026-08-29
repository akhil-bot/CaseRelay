"use client";

import { useCallback, useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import {
  Badge,
  Card,
  EmptyState,
  Field,
  Loading,
  Mono,
  Note,
  Rows,
  cx,
} from "@/components/ui/primitives";
import { control, layout, row, tone, type as type_, type Tone } from "@/design/tokens";
import { listCaseAudit, listCases, type AuditEvent } from "@/lib/api";
import { auditView } from "@/lib/case-events";
import { usePolled } from "@/lib/use-polled";

/** An audit event with the case it was recorded against carried alongside it. */
interface CaseAuditEvent extends AuditEvent {
  caseId: string;
  childName: string;
}

const POLL_INTERVAL = 15_000;

/**
 * Audit is recorded per case and there is no endpoint that spans them, so a
 * fleet-wide trail has to be assembled here: every case, then its events,
 * merged newest first. A case whose audit cannot be read is skipped rather
 * than failing the whole page — one unreadable case should not hide the rest.
 */
async function loadAudit(): Promise<CaseAuditEvent[]> {
  const cases = await listCases();
  const perCase = await Promise.all(
    cases.map(async (record): Promise<CaseAuditEvent[]> => {
      const caseId = String(record.case_id ?? "");
      if (!caseId) return [];
      const events = await listCaseAudit(caseId).catch(() => [] as AuditEvent[]);
      const childName = String(record.child_name || caseId);
      return events.map((event) => ({ ...event, caseId, childName }));
    }),
  );
  return perCase
    .flat()
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
}

export default function ActivityLogPage() {
  const load = useCallback(() => loadAudit(), []);
  const [audit, refresh] = usePolled(load, POLL_INTERVAL);
  const [selectedType, setSelectedType] = useState("all");

  const events = useMemo(() => (audit.status === "loaded" ? audit.data : []), [audit]);

  /**
   * The filters are built from what is actually recorded, so the page never
   * offers one that can only ever come back empty.
   */
  const types = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of events) {
      counts.set(event.event_type, (counts.get(event.event_type) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [events]);

  const filtered = useMemo(
    () =>
      selectedType === "all"
        ? events
        : events.filter((event) => event.event_type === selectedType),
    [events, selectedType],
  );

  if (audit.status === "loading") {
    return (
      <Card
        icon="audit"
        title="Audit trail"
        fill
        className={layout.fillHeight}
        bodyClassName="flex flex-col justify-center"
      >
        <Loading
          icon="audit"
          title="Reading the audit log…"
          hint="Audit is kept per case, so every case is being asked in turn."
        />
      </Card>
    );
  }

  if (audit.status === "error") {
    return (
      <Card icon="alert" title="Control plane error">
        <div className="flex items-start gap-3 rounded-control border border-danger/25 bg-danger/5 px-4 py-3">
          <Icon name="alert" size={18} className="mt-0.5 shrink-0 text-danger" />
          <div>
            <p className="text-[13px] font-medium text-danger">Couldn&apos;t read the audit log</p>
            <p className={cx("mt-1", type_.small)}>{audit.message}</p>
          </div>
        </div>
        <div className="mt-4">
          <button type="button" onClick={refresh} className={control.secondary}>
            <Icon name="retry" size={15} />
            Try again
          </button>
        </div>
      </Card>
    );
  }

  const caseCount = new Set(events.map((event) => event.caseId)).size;
  const traceCount = new Set(events.map((event) => event.trace_id)).size;
  const refusals = events.filter(
    (event) => event.verdict === "deny" || event.verdict === "quarantine",
  ).length;
  const withheld = events.reduce(
    (sum, event) => sum + (event.withheld_fields?.length ?? 0),
    0,
  );

  return (
    <div className={layout.stack}>
      <Card
        icon="audit"
        title="Everything recorded, across every case"
        subtitle="Append-only. Each event keeps the agent that wrote it, the rule outcome, and the trace it belongs to."
        action={
          <button type="button" onClick={refresh} className={control.secondary}>
            <Icon name="retry" size={15} />
            Refresh
          </button>
        }
      >
        <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="Cases covered">
            <Mono>{caseCount}</Mono>
          </Field>
          <Field label="Events recorded">
            <Mono>{events.length}</Mono>{" "}
            <span className="text-ink-muted">
              · {traceCount} {traceCount === 1 ? "trace" : "traces"}
            </span>
          </Field>
          <Field label="Refusals and quarantines">
            <Mono className={refusals > 0 ? "text-danger" : undefined}>{refusals}</Mono>
          </Field>
          <Field label="Fields withheld">
            <Mono>{withheld}</Mono>
          </Field>
        </dl>
      </Card>

      <Card
        icon="activity"
        title="Recorded events"
        subtitle="Newest first. Open a row for what it shared, what it held back, and which trace it belongs to."
        action={<span className={type_.meta}>{filtered.length} shown</span>}
        flush
      >
        {types.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-b border-line px-5 py-3.5">
            <button
              type="button"
              onClick={() => setSelectedType("all")}
              className={selectedType === "all" ? control.chipActive : control.chip}
            >
              <Icon name="audit" size={14} />
              Everything
            </button>
            {types.map(([eventType, count]) => {
              const view = auditView(eventType);
              return (
                <button
                  key={eventType}
                  type="button"
                  onClick={() => setSelectedType(eventType)}
                  className={selectedType === eventType ? control.chipActive : control.chip}
                >
                  <Icon name={view.icon} size={14} />
                  {view.label}
                  <span className="font-mono text-[11px] text-ink-muted">{count}</span>
                </button>
              );
            })}
          </div>
        )}

        {filtered.length === 0 ? (
          <div className="px-5 py-4">
            <EmptyState
              icon="clock"
              title={
                events.length === 0
                  ? "Nothing has been recorded yet."
                  : "No events of that kind."
              }
              hint={
                events.length === 0
                  ? "An event is written the first time an agent shares something, refuses something, or checks back on a case."
                  : undefined
              }
            />
          </div>
        ) : (
          <Rows as="ol">
            {filtered.map((event) => (
              <AuditRow key={`${event.caseId}-${event.event_id}`} event={event} />
            ))}
          </Rows>
        )}
      </Card>

      <Note icon="document">
        Agents record evidence, outcomes, and human-readable explanations — not private
        chain-of-thought. Raw documents stay in object storage; shared state holds only
        operational facts with source, timestamp, purpose, and retention metadata.
      </Note>
    </div>
  );
}

function verdictTone(verdict: string): Tone {
  if (verdict === "deny" || verdict === "quarantine") return "danger";
  if (verdict === "no_response" || verdict === "supervisor_notified" || verdict === "deferred") {
    return "warn";
  }
  if (verdict === "allow" || verdict === "answered") return "seal";
  return "neutral";
}

/** Local clock time with the date, because the trail spans days. */
function formatStamp(timestamp: string): string {
  const ms = Date.parse(timestamp);
  if (Number.isNaN(ms)) return timestamp;
  return new Date(ms).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function AuditRow({ event }: { event: CaseAuditEvent }) {
  const [open, setOpen] = useState(false);
  const view = auditView(event.event_type);

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={cx("w-full text-left", row.pad, row.hover)}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cx(
              "flex size-7 shrink-0 items-center justify-center rounded-full border",
              tone[view.variant].badge,
            )}
          >
            <Icon name={view.icon} size={14} />
          </span>
          <span className="text-[12.5px] font-medium text-ink">{view.label}</span>
          {event.verdict && (
            <Badge variant={verdictTone(event.verdict)}>{event.verdict.replace(/_/g, " ")}</Badge>
          )}
          <span className={type_.meta}>{event.childName}</span>
          <Mono className="text-[11px]">{event.caseId}</Mono>
          <Mono className="ml-auto text-[11px]">{formatStamp(event.timestamp)}</Mono>
          <Icon
            name={open ? "chevronDown" : "chevronRight"}
            size={14}
            className="shrink-0 text-ink-muted"
          />
        </div>
      </button>

      {/* A disclosure, so it stays a full-bleed band under its row: tinted and
          ruled off, never boxed. */}
      {open && (
        <div className="animate-rise border-t border-line bg-surface-soft px-5 py-3.5">
          {event.explanation && <p className={type_.small}>{event.explanation}</p>}

          {(event.disclosed_fields?.length || event.withheld_fields?.length) && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {event.disclosed_fields && event.disclosed_fields.length > 0 && (
                <FieldList label="Shared" fields={event.disclosed_fields} variant="brand" />
              )}
              {event.withheld_fields && event.withheld_fields.length > 0 && (
                <FieldList label="Held back" fields={event.withheld_fields} variant="danger" />
              )}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-ink-muted">
            {event.agent_identity && (
              <span className="flex items-center gap-1.5">
                <Icon name="identity" size={13} />
                <Mono className="text-[11px]">{event.agent_identity}</Mono>
              </span>
            )}
            {event.purpose && <Badge variant="neutral">{event.purpose.replace(/_/g, " ")}</Badge>}
            {event.commitment_type && (
              <Badge variant="neutral">{event.commitment_type.replace(/_/g, " ")}</Badge>
            )}
            {event.legal_basis && (
              <span className="flex items-center gap-1.5">
                <Icon name="shield" size={13} />
                {event.legal_basis.replace(/_/g, " ")}
              </span>
            )}
            {event.denied_field && (
              <span className="flex items-center gap-1.5 text-danger">
                <Icon name="close" size={13} />
                <Mono className="text-[11px]">{event.denied_field}</Mono>
              </span>
            )}
            {event.expected_principal && (
              <span className="flex items-center gap-1.5">
                <Icon name="lock" size={13} />
                expected <Mono className="text-[11px]">{event.expected_principal}</Mono>
              </span>
            )}
            {event.workflow_ids && event.workflow_ids.length > 0 && (
              <span className="flex items-center gap-1.5">
                <Icon name="sleep" size={13} />
                {event.workflow_ids.join(", ")}
              </span>
            )}
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-ink-muted">
            <span className="flex items-center gap-1.5">
              <Icon name="audit" size={13} />
              <Mono className="text-[11px]">{event.event_id}</Mono>
            </span>
            <span className="flex items-center gap-1.5">
              <Icon name="activity" size={13} />
              trace <Mono className="break-all text-[11px]">{event.trace_id}</Mono>
            </span>
          </div>
        </div>
      )}
    </li>
  );
}

function FieldList({
  label,
  fields,
  variant,
}: {
  label: string;
  fields: string[];
  variant: "brand" | "danger";
}) {
  return (
    <div>
      <p className={type_.label}>
        {label} · {fields.length}
      </p>
      <ul className="mt-1.5 flex flex-wrap gap-1.5">
        {fields.map((field) => (
          <li
            key={field}
            className={cx(
              "rounded-full border px-2.5 py-1 font-mono text-[11px]",
              variant === "brand"
                ? "border-brand/25 bg-brand-soft text-brand-deep"
                : "border-danger/25 bg-danger/5 text-danger line-through decoration-danger/40",
            )}
          >
            {field}
          </li>
        ))}
      </ul>
    </div>
  );
}
