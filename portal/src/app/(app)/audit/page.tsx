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
import { AUDIT_PAGE, listAudit, type FleetAuditEvent } from "@/lib/api";
import { auditView } from "@/lib/case-events";
import { usePolled } from "@/lib/use-polled";

const POLL_INTERVAL = 15_000;

const EMPTY: FleetAuditEvent[] = [];

export default function ActivityLogPage() {
  const [selectedType, setSelectedType] = useState("all");
  const eventType = selectedType === "all" ? undefined : selectedType;

  // Only the newest page is polled. The trail is append-only and newest first,
  // so everything below the first page is settled and re-reading it every
  // fifteen seconds would be asking a question whose answer cannot have changed.
  const load = useCallback(
    () => listAudit({ eventType, offset: 0, limit: AUDIT_PAGE }),
    [eventType],
  );
  const [audit, refresh] = usePolled(load, POLL_INTERVAL);

  // Pages fetched behind the first, each at its own offset, kept as they land.
  const [earlier, setEarlier] = useState<FleetAuditEvent[]>(EMPTY);
  const [reading, setReading] = useState(false);

  const page = audit.status === "loaded" ? audit.data : null;
  const newest = page?.events ?? EMPTY;
  // Counted across the whole trail rather than the page, so the figures above
  // the list describe the record and not the reader's scroll position.
  const summary = page?.summary;
  const total = page?.total ?? 0;

  // An event written between two page reads shifts everything after it down by
  // one, which can hand the same row back at the next offset. Keyed on the
  // event id, so it is shown once wherever it turns up.
  const events = useMemo(() => {
    const seen = new Set(newest.map((event) => event.event_id));
    return [...newest, ...earlier.filter((event) => !seen.has(event.event_id))];
  }, [newest, earlier]);

  // Narrowing is done on the control plane now, so a new filter is a new
  // question, read from the top of the trail rather than inheriting how far the
  // last one had been followed.
  const choose = useCallback((next: string) => {
    setSelectedType(next);
    setEarlier(EMPTY);
  }, []);

  const showMore = useCallback(async () => {
    setReading(true);
    try {
      const next = await listAudit({ eventType, offset: events.length, limit: AUDIT_PAGE });
      setEarlier((prev) => [...prev, ...next.events]);
    } catch {
      // Nothing to say that the list does not already say. What is on screen
      // stays, and the button can be pressed again.
    } finally {
      setReading(false);
    }
  }, [eventType, events.length]);

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
          hint="The newest entries first, across every case."
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

  const caseCount = summary?.cases ?? 0;
  const eventCount = summary?.events ?? 0;
  const traceCount = summary?.traces ?? 0;
  const refusals = summary?.refusals ?? 0;
  const withheld = summary?.withheld ?? 0;
  const types = summary?.types ?? [];
  const more = events.length < total;

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
            <Mono>{eventCount}</Mono>{" "}
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
        action={
          <span className={type_.meta}>
            {events.length === total
              ? `${total} shown`
              : `${events.length} of ${total} shown`}
          </span>
        }
        flush
      >
        {types.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-b border-line px-5 py-3.5">
            <button
              type="button"
              onClick={() => choose("all")}
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
                  onClick={() => choose(eventType)}
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

        {events.length === 0 ? (
          <div className="px-5 py-4">
            <EmptyState
              icon="clock"
              title={
                eventCount === 0
                  ? "Nothing has been recorded yet."
                  : "No events of that kind."
              }
              hint={
                eventCount === 0
                  ? "An event is written the first time an agent shares something, refuses something, or checks back on a case."
                  : undefined
              }
            />
          </div>
        ) : (
          <>
            <Rows as="ol">
              {events.map((event) => (
                <AuditRow key={`${event.case_id}-${event.event_id}`} event={event} />
              ))}
            </Rows>

            {more && (
              <div className="border-t border-line px-5 py-3.5">
                <button
                  type="button"
                  onClick={() => void showMore()}
                  disabled={reading}
                  className={control.secondary}
                >
                  <Icon name={reading ? "clock" : "chevronDown"} size={15} />
                  {reading
                    ? "Reading…"
                    : `Show ${Math.min(AUDIT_PAGE, total - events.length)} more`}
                </button>
              </div>
            )}
          </>
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

function AuditRow({ event }: { event: FleetAuditEvent }) {
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
          <span className={type_.meta}>{event.child_name || event.case_id}</span>
          <Mono className="text-[11px]">{event.case_id}</Mono>
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
