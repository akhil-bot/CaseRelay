"use client";

import { useMemo, useState } from "react";
import { Icon, type IconName } from "@/components/icons";
import { AccessNotice } from "@/components/shell/AccessNotice";
import { KIND_META } from "@/components/shell/ActivityPanel";
import {
  Badge,
  Card,
  EmptyState,
  Field,
  Mono,
  Note,
  OutcomeBadge,
  cx,
} from "@/components/ui/primitives";
import { control, layout, surface, tone, type as type_ } from "@/design/tokens";
import { useDemo } from "@/lib/demo-store";
import { TRACE_ID, WORKFLOW_ID } from "@/lib/mock/cases";
import { useViewer } from "@/lib/viewer";
import type { ActivityEvent, ActivityKind } from "@/lib/types";

const GROUPS: { id: string; label: string; icon: IconName; kinds: ActivityKind[] }[] = [
  { id: "all", label: "Everything", icon: "audit", kinds: [] },
  { id: "discovery", label: "Discovery", icon: "registry", kinds: ["registry"] },
  { id: "execution", label: "Runtime & memory", icon: "memory", kinds: ["runtime", "memory"] },
  { id: "calls", label: "Model & tool", icon: "sparkle", kinds: ["model", "tool"] },
  {
    id: "security",
    label: "Identity, gateway & armor",
    icon: "lock",
    kinds: ["identity", "gateway", "armor"],
  },
  {
    id: "governance",
    label: "Policy & human",
    icon: "shield",
    kinds: ["policy", "approval", "retry"],
  },
  { id: "completion", label: "Callback & audit", icon: "mail", kinds: ["callback", "audit"] },
];

export default function ActivityLogPage() {
  const { activity, policyDecisions } = useDemo();
  const { showsTechnical } = useViewer();
  const [group, setGroup] = useState("all");

  const filtered = useMemo(() => {
    const target = GROUPS.find((item) => item.id === group);
    if (!target || target.kinds.length === 0) return activity;
    return activity.filter((event) => target.kinds.includes(event.kind));
  }, [activity, group]);

  const maxSpan = Math.max(...activity.map((event) => event.spanMs), 1);
  const totalMs = activity.reduce((sum, event) => sum + event.spanMs, 0);
  const refusals = activity.filter(
    (event) => event.outcome === "deny" || event.outcome === "quarantine",
  ).length;

  if (!showsTechnical) {
    return <AccessNotice what="The trace and audit log" />;
  }

  return (
    <div className={layout.stack}>
      <Card
        icon="audit"
        title="One trace, end to end"
        subtitle="Discovery, runtime transitions, model and tool calls, policy decisions, retries, approval, and completion."
      >
        <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="Trace">
            <Mono className="text-brand-deep">{TRACE_ID}</Mono>
          </Field>
          <Field label="Workflow">
            <Mono>{WORKFLOW_ID}</Mono>
          </Field>
          <Field label="Spans recorded">
            <Mono>{activity.length}</Mono>{" "}
            <span className="text-ink-muted">· {totalMs.toLocaleString()}ms of agent time</span>
          </Field>
          <Field label="Refusals and quarantines">
            <Mono className={refusals > 0 ? "text-danger" : undefined}>{refusals}</Mono>
          </Field>
        </dl>
      </Card>

      <Card
        icon="activity"
        title="Correlated spans"
        subtitle="Append-only. Every row keeps its actor, timing, and policy outcome."
        action={<span className={type_.meta}>{filtered.length} shown</span>}
        bodyClassName="px-3 py-3"
      >
        <div className="mb-3 flex flex-wrap gap-1.5 px-1">
          {GROUPS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setGroup(option.id)}
              className={group === option.id ? control.chipActive : control.chip}
            >
              <Icon name={option.icon} size={14} />
              {option.label}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon="clock"
            title="No spans of this type yet."
            hint="Advance the scenario clock to generate more of the trace."
          />
        ) : (
          <ol className="space-y-1.5">
            {filtered.map((event) => (
              <SpanRow key={event.id} event={event} maxSpan={maxSpan} />
            ))}
          </ol>
        )}
      </Card>

      <Card
        icon="shield"
        title="Policy decision log"
        subtitle="Every allow, refusal, quarantine, and human-approval requirement with the rules that produced it."
        bodyClassName="px-3 py-3"
      >
        {policyDecisions.length === 0 ? (
          <EmptyState icon="shield" title="No policy decisions recorded yet." />
        ) : (
          <ul className="grid gap-2 3xl:grid-cols-2">
            {policyDecisions.map((decision) => (
              <li key={decision.id} className={cx(surface.inset, "px-4 py-3.5")}>
                <div className="flex flex-wrap items-center gap-2">
                  <Mono className="text-brand-deep">{decision.id}</Mono>
                  <OutcomeBadge outcome={decision.outcome} />
                  <span className="text-[13px] font-medium text-ink">{decision.subject}</span>
                  <Mono className="ml-auto text-[11px]">{decision.at}</Mono>
                </div>
                <p className={cx("mt-2", type_.small)}>{decision.explanation}</p>
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  {decision.ruleIds.map((ruleId) => (
                    <Badge key={ruleId} variant="neutral">
                      {ruleId}
                    </Badge>
                  ))}
                  {decision.projection && (
                    <Badge variant="warn" icon="gateway">
                      {decision.projection.disclosed.length} disclosed ·{" "}
                      {decision.projection.withheld.length} withheld
                    </Badge>
                  )}
                </div>
                {decision.retryInstruction && (
                  <p className="mt-2.5 flex items-start gap-2 rounded-control border border-line bg-surface px-3 py-2.5 text-[12px] text-ink-soft">
                    <Icon name="retry" size={14} className="mt-0.5 shrink-0 text-warn" />
                    <span>
                      <span className="font-medium text-ink">Safe retry: </span>
                      {decision.retryInstruction}
                    </span>
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Note icon="document">
        Agents record evidence, applied rules, and human-readable explanations — not private
        chain-of-thought. Raw synthetic documents stay in object storage; shared state holds only
        operational facts with source, timestamp, purpose, and retention metadata.
      </Note>
    </div>
  );
}

function SpanRow({ event, maxSpan }: { event: ActivityEvent; maxSpan: number }) {
  const [open, setOpen] = useState(false);
  const kind = KIND_META[event.kind];
  const width = event.spanMs === 0 ? 4 : Math.max(4, Math.round((event.spanMs / maxSpan) * 100));

  return (
    <li className={cx(surface.inset, "overflow-hidden")}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="w-full px-4 py-3 text-left"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cx(
              "flex size-7 shrink-0 items-center justify-center rounded-full border",
              tone[kind.variant].badge,
            )}
          >
            <Icon name={kind.icon} size={14} />
          </span>
          <Mono className="text-[11px]">{event.id}</Mono>
          <span className="text-[12.5px] font-medium text-ink">{event.summary}</span>
          {event.outcome && <OutcomeBadge outcome={event.outcome} />}
          <Mono className="ml-auto text-[11px]">{event.at}</Mono>
          <Icon
            name={open ? "chevronDown" : "chevronRight"}
            size={14}
            className="shrink-0 text-ink-muted"
          />
        </div>

        <div className="mt-2.5 flex items-center gap-2">
          <span className="h-1 flex-1 overflow-hidden rounded-full bg-surface-muted">
            <span
              className={cx("block h-full rounded-full", tone[kind.variant].bar)}
              style={{ width: `${width}%` }}
            />
          </span>
          <span className="w-16 shrink-0 text-right font-mono text-[10.5px] text-ink-muted">
            {event.spanMs === 0 ? "human" : `${event.spanMs}ms`}
          </span>
        </div>
      </button>

      {open && (
        <div className="animate-rise border-t border-line bg-surface px-4 py-3">
          <p className={type_.small}>{event.detail}</p>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-ink-muted">
            <span className="flex items-center gap-1.5">
              <Icon name="identity" size={13} />
              <Mono className="text-[11px]">{event.actor}</Mono>
            </span>
            <span className="flex items-center gap-1.5">
              <Icon name="calendar" size={13} />
              day offset {event.dayOffset}
            </span>
            {event.idempotencyKey && (
              <span className="flex items-center gap-1.5">
                <Icon name="lock" size={13} />
                <Mono className="text-[11px]">{event.idempotencyKey}</Mono>
              </span>
            )}
            {event.capability && <Badge variant="brand">{event.capability}</Badge>}
          </div>
        </div>
      )}
    </li>
  );
}
