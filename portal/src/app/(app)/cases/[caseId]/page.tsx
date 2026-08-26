"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { CaseTimeline } from "@/components/live/CaseTimeline";
import { LiveActivityFeed } from "@/components/live/LiveActivityFeed";
import { NeedsAttention } from "@/components/live/NeedsAttention";
import {
  Avatar,
  Badge,
  Card,
  DOMAIN_META,
  DomainIcon,
  EmptyState,
  Field,
  FlagBadge,
  Group,
  Mono,
  ProgressBar,
  Rows,
  StatusBadge,
  cx,
} from "@/components/ui/primitives";
import { fieldLabel, purposeLabel } from "@/design/copy";
import { control, layout, row, surface, tone, type as type_ } from "@/design/tokens";
import { auditView, formatEventTime } from "@/lib/case-events";
import { useDemo } from "@/lib/demo-store";
import { submitRun, type CaseRunSummary, type RunEvent } from "@/lib/api";
import { useLiveCase, useLiveRunEvents } from "@/lib/live-case";
import { AUTHORITY_GRANT, CASES, PRIMARY_CASE_ID } from "@/lib/mock/cases";
import { EDUCATION_PROJECTION } from "@/lib/mock/policy";
import { useViewer } from "@/lib/viewer";
import type { Commitment, CommitmentStatus, Domain } from "@/lib/types";

// ---------------------------------------------------------------------------
// Route decision: mock walkthrough vs live control-plane data
//
// The CASES array contains the hardcoded demo-store IDs (CR-1042, CR-1038,
// etc.). If the URL's caseId is one of those, render the scripted walkthrough.
// If it is NOT in that list, it is a real case created via /admin or the API —
// fetch it from the control plane and render live data.
//
// There is NO silent fallback from one to the other. A broken live fetch
// shows an error; it does not quietly swap in mock data.
// ---------------------------------------------------------------------------

const MOCK_CASE_IDS = new Set(CASES.map((c) => c.id));

export default function CaseDetailPage() {
  const params = useParams<{ caseId: string }>();
  const caseId = params?.caseId ?? PRIMARY_CASE_ID;

  if (MOCK_CASE_IDS.has(caseId)) {
    return <MockCaseDetail caseId={caseId} />;
  }
  return <LiveCaseDetail caseId={caseId} />;
}

// ═══════════════════════════════════════════════════════════════════════════
// Live case detail — fetched from the control plane
// ═══════════════════════════════════════════════════════════════════════════

const NO_RUNS: CaseRunSummary[] = [];
const NO_EVENTS: RunEvent[] = [];

const eventKey = (e: RunEvent) => `${e.run_id}-${e.event}-${e.phase ?? ""}-${e.timestamp ?? ""}`;

function LiveCaseDetail({ caseId }: { caseId: string }) {
  const [liveCase, refreshCase] = useLiveCase(caseId);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [startedRunId, setStartedRunId] = useState<string | null>(null);

  const runs = liveCase.status === "loaded" ? liveCase.runs : NO_RUNS;
  const caseEvents = liveCase.status === "loaded" ? liveCase.events : NO_EVENTS;

  // Which run to listen to. The newest one, because a suspended run is replaced
  // by its successor the moment a scheduled wake fires — except for a run just
  // started from this page, which the case does not know about yet.
  const watchedRunId = useMemo(() => {
    if (startedRunId && !runs.some((r) => r.run_id === startedRunId)) return startedRunId;
    const active = runs.find((r) => r.state === "running" || r.state === "queued");
    return (active ?? runs[0])?.run_id ?? null;
  }, [runs, startedRunId]);

  const runState = useLiveRunEvents(watchedRunId);

  useEffect(() => {
    // A round of outreach that has just finished has changed the commitments
    // underneath the page. Read them now rather than at the next poll.
    if (!runState.streaming && runState.terminalState) refreshCase();
  }, [runState.streaming, runState.terminalState, refreshCase]);

  // The recorded history covers every run; the stream covers the one being
  // watched, and gets there first. Both together, oldest first, no duplicates.
  const mergedEvents = useMemo(() => {
    if (caseEvents.length === 0) return runState.events;
    const seen = new Set(caseEvents.map(eventKey));
    const live = runState.events.filter((e) => !seen.has(eventKey(e)));
    return [...caseEvents, ...live].sort(
      (a, b) => String(a.timestamp ?? "").localeCompare(String(b.timestamp ?? "")),
    );
  }, [caseEvents, runState.events]);

  const handleRun = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const ref = await submitRun(caseId);
      setStartedRunId(ref.run_id);
      refreshCase();
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (liveCase.status === "loading") {
    return (
      <div className={layout.stack}>
        <Breadcrumb label={caseId} />
        <Card icon="cases" title={caseId}>
          <div className="flex items-center gap-3 py-8">
            <span className="inline-block size-4 animate-spin rounded-full border-2 border-brand border-t-transparent" />
            <span className={type_.body}>Loading case details…</span>
          </div>
        </Card>
      </div>
    );
  }

  if (liveCase.status === "not_found") {
    return (
      <div className={layout.stack}>
        <Breadcrumb label={caseId} />
        <Card icon="cases" title="Case not found">
          <EmptyState
            icon="search"
            title={`Case ${caseId} does not exist on the control plane.`}
            hint="Create it in /admin first, or check the case ID."
          />
          <div className="mt-4 flex justify-center">
            <Link href="/admin" className={control.primary}>
              Open Synthetic Data Lab
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  if (liveCase.status === "error") {
    return (
      <div className={layout.stack}>
        <Breadcrumb label={caseId} />
        <Card icon="alert" title="Control plane error">
          <div className="flex items-start gap-3 rounded-control border border-danger/25 bg-danger/5 px-4 py-3">
            <Icon name="alert" size={18} className="mt-0.5 shrink-0 text-danger" />
            <div>
              <p className="text-[13px] font-medium text-danger">
                Couldn&apos;t load the case details
              </p>
              <p className={cx("mt-1", type_.small)}>{liveCase.message}</p>
            </div>
          </div>
          <div className="mt-4 flex justify-center">
            <Link href="/cases" className={control.secondary}>
              Back to list
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  const { data } = liveCase;
  const caseData = data.case;
  const childName = String(caseData.child_name ?? caseId);
  const referral = (caseData.referral_packet ?? {}) as Record<string, unknown>;
  const scenario = String(caseData.scenario ?? referral.scenario ?? "");
  const status = String(caseData.status ?? "unknown");
  const commitmentStates = data.commitments;
  const commitmentEntries = Object.entries(commitmentStates);
  const TERMINAL_STATUSES = new Set(["completed", "blocked", "unresolved"]);
  const closedCount = commitmentEntries.filter(([, v]) => TERMINAL_STATUSES.has(v)).length;
  const hasActiveRun = runs.some((r) => r.state === "running" || r.state === "queued");
  const isStreaming = runState.streaming || hasActiveRun;

  return (
    <div className={layout.stack}>
      <Breadcrumb label={childName} />

      <section className={cx(surface.card, "overflow-hidden px-5 py-5")}>
        <div className="flex flex-wrap items-start gap-4">
          <Avatar name={childName} size={52} variant="brand" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[18px] font-semibold text-ink">{childName}</h2>
              <Mono className="text-[12px]">{caseId}</Mono>
              <Badge variant="accent" icon="activity">Live</Badge>
              {scenario && <Badge variant="neutral">{scenario}</Badge>}
            </div>
            <p className={cx("mt-1.5", layout.measure, type_.body)}>
              {String(caseData.summary ?? `Case ${caseId} — scenario ${scenario}`)}
            </p>
          </div>
          <Badge
            variant={status === "closed" ? "brand" : status === "monitoring" ? "brand" : "neutral"}
            icon={status === "closed" ? "checkCircle" : "activity"}
          >
            {caseStatusLabel(status)}
          </Badge>
        </div>

        <dl className="mt-5 grid gap-4 border-t border-line pt-4 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="Case ID">
            <Mono>{caseId}</Mono>
          </Field>
          <Field label="Scenario">
            {scenario || "—"}
          </Field>
          <Field label="Status">
            {caseStatusLabel(status)}
          </Field>
          <Field label="Commitments">
            {closedCount} of {commitmentEntries.length} closed
          </Field>
        </dl>

        {!hasActiveRun && !runState.streaming && (
          <div
            className={cx(
              "-mx-5 -mb-5 mt-5 flex flex-wrap items-center gap-3 border-t px-5 py-4",
              "border-brand/25 bg-brand-soft text-brand",
            )}
          >
            <Icon name="play" size={18} className="shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium">
                {runs.length === 0 ? "No outreach started yet" : "Start another round of outreach"}
              </p>
              <p className="mt-0.5 text-[12px] text-ink-soft">
                Contact all service providers and follow up on each step.
              </p>
            </div>
            <button
              type="button"
              onClick={handleRun}
              disabled={submitting}
              className={control.primary}
            >
              <Icon name="play" size={15} />
              {submitting ? "Starting…" : "Start outreach"}
            </button>
          </div>
        )}
        {submitError && (
          <p className="mt-2 text-[12px] text-danger">{submitError}</p>
        )}
      </section>

      <NeedsAttention commitments={commitmentStates} events={mergedEvents} />

      <CaseTimeline
        caseData={caseData}
        commitments={commitmentStates}
        runs={runs}
        events={mergedEvents}
      />

      {/* Commitment states from backend */}
      {commitmentEntries.length > 0 && (
        <Card
          icon="cases"
          title="Commitments"
          subtitle={`${closedCount} of ${commitmentEntries.length} closed`}
          action={
            <div className="flex w-40 items-center gap-3">
              <ProgressBar value={closedCount} total={commitmentEntries.length} variant="seal" />
            </div>
          }
          flush
        >
          <Rows as="ol">
            {commitmentEntries.map(([type, commitmentStatus]) => (
              <li key={type} className={cx("border-l-2", row.pad,
                commitmentStatus === "completed" ? "border-l-seal"
                  : commitmentStatus === "blocked" ? "border-l-danger"
                  : "border-l-transparent",
              )}>
                <div className="flex items-center gap-3">
                  <DomainIcon domain={type as Domain} size={32} />
                  <div className="min-w-0 flex-1">
                    <span className="text-[13.5px] font-medium text-ink">
                      {DOMAIN_META[type as Domain]?.label ?? type.replace(/_/g, " ")}
                    </span>
                  </div>
                  <StatusBadge status={commitmentStatus as CommitmentStatus} />
                </div>
              </li>
            ))}
          </Rows>
        </Card>
      )}

      {/* Live activity feed — stitched across all runs for timeline continuity */}
      {(isStreaming || runs.length > 0 || mergedEvents.length > 0) && (
        <LiveActivityFeed run={{ ...runState, events: mergedEvents }} />
      )}

      {/* Audit trail (from initial case fetch) */}
      {data.timeline.length > 0 && (
        <Card
          icon="audit"
          title="Audit trail"
          subtitle="What was shared, what was refused, and when."
          flush
        >
          <Rows>
            {data.timeline.map((entry, i) => (
              <AuditRow key={i} entry={entry} />
            ))}
          </Rows>
        </Card>
      )}
    </div>
  );
}

/**
 * One line of the audit log. The backend writes it as a machine event type with
 * an agent identity attached; both are read here through the same vocabulary the
 * activity feed uses, so one moment is not named twice on one page.
 */
function AuditRow({ entry }: { entry: Record<string, unknown> }) {
  const e = entry as Record<string, string>;
  const view = auditView(String(e.event_type ?? e.type ?? ""));
  const domain = e.commitment_type in DOMAIN_META ? (e.commitment_type as Domain) : null;
  const detail = e.explanation || e.detail || (e.purpose ? purposeLabel(e.purpose) : "");
  const at = formatEventTime(e.timestamp);

  return (
    <li className={cx(row.pad, "flex items-start gap-3")}>
      <span
        className={cx(
          "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border",
          tone[view.variant].badge,
        )}
      >
        <Icon name={view.icon} size={13} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] font-medium text-ink">{view.label}</span>
          {domain && <Badge variant="neutral">{DOMAIN_META[domain].label}</Badge>}
        </div>
        {detail && <p className={cx("mt-0.5", type_.meta)}>{detail}</p>}
      </div>
      {at && (
        <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-ink-muted">{at}</span>
      )}
    </li>
  );
}

function Breadcrumb({ label }: { label: string }) {
  return (
    <nav className="flex items-center gap-1.5 text-[12px] text-ink-muted">
      <Link href="/cases" className="transition-colors hover:text-ink">
        My cases
      </Link>
      <Icon name="chevronRight" size={13} />
      <span className="text-ink-soft">{label}</span>
    </nav>
  );
}

function caseStatusLabel(status: string): string {
  if (status === "monitoring") return "CaseRelay is watching";
  if (status === "attention_required") return "Needs attention";
  if (status === "intake_review") return "Pending intake";
  if (status === "approval_required") return "Waiting on you";
  if (status === "completed" || status === "closed") return "Completed";
  return status.replace(/_/g, " ");
}

// ═══════════════════════════════════════════════════════════════════════════
// Mock case detail — the scripted walkthrough (unchanged from before)
// ═══════════════════════════════════════════════════════════════════════════

function MockCaseDetail({ caseId }: { caseId: string }) {
  const { step, setStep, commitments, cases } = useDemo();
  const { copy } = useViewer();
  const record = cases.find((item) => item.id === caseId);

  if (!record) {
    return (
      <Card icon="cases" title="Not found">
        <EmptyState
          icon="search"
          title={`Nothing here matches ${caseId}.`}
          hint="Pick one from the list instead."
        />
        <div className="mt-4 flex justify-center">
          <Link href="/cases" className={control.primary}>
            Back to the list
          </Link>
        </div>
      </Card>
    );
  }

  const isPrimary = caseId === PRIMARY_CASE_ID;
  const activated = !isPrimary || step >= 1;
  const closed = commitments.filter((item) => item.status === "completed").length;

  return (
    <div className={layout.stack}>
      <nav className="flex items-center gap-1.5 text-[12px] text-ink-muted">
        <Link href="/cases" className="transition-colors hover:text-ink">
          My cases
        </Link>
        <Icon name="chevronRight" size={13} />
        <span className="text-ink-soft">{record.childAlias}</span>
      </nav>

      <section className={cx(surface.card, "overflow-hidden px-5 py-5")}>
        <div className="flex flex-wrap items-start gap-4">
          <Avatar name={record.childAlias} size={52} variant={activated ? "brand" : "neutral"} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[18px] font-semibold text-ink">{record.childAlias}</h2>
              <Mono className="text-[12px]">{record.id}</Mono>
              {record.flags.map((flag) => (
                <FlagBadge key={flag} flag={flag} />
              ))}
            </div>
            <p className={cx("mt-1.5", layout.measure, type_.body)}>{record.headline}</p>
          </div>
          <Badge variant={activated ? "brand" : "warn"} icon={activated ? "check" : "clock"}>
            {activated ? "CaseRelay is watching this" : "Not started yet"}
          </Badge>
        </div>

        <dl className="mt-5 grid gap-4 border-t border-line pt-4 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="Court order">
            <Mono>{record.courtOrder}</Mono>
          </Field>
          <Field label="Advocate">{record.volunteer}</Field>
          <Field label="Your supervisor">{record.supervisor}</Field>
          <Field label="Permission expires">{AUTHORITY_GRANT.expiresOn}</Field>
        </dl>

        {isPrimary && step === 0 && (
          <ActionBar
            variant="warn"
            icon="lock"
            title="Your supervisor needs to confirm the court order"
            body="CaseRelay has read the referral and listed five next steps. It will not start chasing anyone until a supervisor confirms the court appointment."
            cta="Confirm and start watching"
            onAct={() => setStep(1)}
          />
        )}

        {isPrimary && step === 3 && (
          <ActionBar
            variant="accent"
            icon="sleep"
            title="Nothing is due right now"
            body="CaseRelay has gone quiet on purpose. It will wake itself up when a date passes — you do not have to remember."
            cta="Jump ahead to day 17"
            onAct={() => setStep(4)}
          />
        )}
      </section>

      <Card
        icon="cases"
        title={copy.caseDetail.commitments.title}
        subtitle={copy.caseDetail.commitments.subtitle}
        action={
          <div className="flex w-40 items-center gap-3">
            <ProgressBar value={closed} total={commitments.length} variant="seal" />
          </div>
        }
        flush
      >
        <Rows as="ol">
          {commitments.map((commitment) => (
            <CommitmentRow
              key={commitment.id}
              commitment={commitment}
              evidenceLabel={copy.caseDetail.evidenceLabel}
            />
          ))}
        </Rows>
      </Card>

      {isPrimary && step >= 4 && (
        <Card
          icon="gateway"
          title={copy.caseDetail.projection.title}
          subtitle={copy.caseDetail.projection.subtitle}
        >
          <div className="grid gap-5 lg:grid-cols-2">
            <Group
              variant="brand"
              icon="check"
              label={copy.caseDetail.disclosedLabel}
              count={EDUCATION_PROJECTION.disclosed.length}
            >
              <ul className="space-y-1.5">
                {EDUCATION_PROJECTION.disclosed.map((field) => (
                  <li key={field}>
                    <span className="text-[12.5px] text-ink">{fieldLabel(field)}</span>
                  </li>
                ))}
              </ul>
            </Group>
            <Group
              variant="danger"
              icon="close"
              label={copy.caseDetail.withheldLabel}
              count={EDUCATION_PROJECTION.withheld.length}
            >
              <ul className="space-y-2">
                {EDUCATION_PROJECTION.withheld.map((entry) => (
                  <li key={entry.field}>
                    <span className="text-[12.5px] text-ink-soft line-through decoration-danger/40">
                      {fieldLabel(entry.field)}
                    </span>
                  </li>
                ))}
              </ul>
            </Group>
          </div>
          <p className={cx("mt-5 flex items-start gap-2.5 border-t border-line pt-4", type_.meta)}>
            <Icon name="shield" size={15} className="mt-px shrink-0" />
            <span className={cx("leading-relaxed", layout.measure)}>
              {copy.caseDetail.projectionNote}
            </span>
          </p>
        </Card>
      )}

      {isPrimary && step >= 7 && (
        <Card
          icon="users"
          title={copy.caseDetail.handoff.title}
          subtitle={copy.caseDetail.handoff.subtitle}
        >
          <div className="grid gap-5 lg:grid-cols-2">
            <Group
              variant="brand"
              icon="check"
              label="Carries over to the next volunteer"
            >
              <ul className="space-y-1.5">
                {[
                  "Every step, and who is responsible for it",
                  "The dates CaseRelay is still watching for",
                  "Who to contact at each organization",
                ].map((entry) => (
                  <li key={entry} className="flex items-start gap-2 text-[12.5px] text-ink-soft">
                    <Icon name="check" size={14} className="mt-0.5 shrink-0 text-brand" />
                    {entry}
                  </li>
                ))}
              </ul>
            </Group>
            <Group
              variant="danger"
              icon="close"
              label="Stops immediately"
            >
              <ul className="space-y-1.5">
                {[
                  "The previous volunteer's access to this case",
                  "Their ability to open the referral documents",
                  "Any approval requests still sitting with them",
                ].map((entry) => (
                  <li key={entry} className="flex items-start gap-2 text-[12.5px] text-ink-soft">
                    <Icon name="close" size={14} className="mt-0.5 shrink-0 text-danger" />
                    {entry}
                  </li>
                ))}
              </ul>
            </Group>
          </div>
        </Card>
      )}

    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Shared sub-components
// ═══════════════════════════════════════════════════════════════════════════

function ActionBar({
  variant,
  icon,
  title,
  body,
  cta,
  onAct,
}: {
  variant: "warn" | "accent";
  icon: "lock" | "sleep";
  title: string;
  body: string;
  cta: string;
  onAct: () => void;
}) {
  const skin =
    variant === "warn"
      ? "border-warn/25 bg-warn-soft text-warn"
      : "border-accent/25 bg-accent-soft text-accent-deep";
  return (
    <div
      className={cx(
        "-mx-5 -mb-5 mt-5 flex flex-wrap items-center gap-3 border-t px-5 py-4",
        skin,
      )}
    >
      <Icon name={icon} size={18} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium">{title}</p>
        <p className="mt-0.5 text-[12px] text-ink-soft">{body}</p>
      </div>
      <button type="button" onClick={onAct} className={control.primary}>
        {cta}
        <Icon name="arrowRight" size={15} />
      </button>
    </div>
  );
}

function CommitmentRow({
  commitment,
  evidenceLabel,
}: {
  commitment: Commitment;
  evidenceLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const overdue = (commitment.daysOverdue ?? 0) > 0;

  return (
    <li
      className={cx(
        "border-l-2",
        row.pad,
        overdue
          ? "border-l-danger"
          : commitment.status === "completed"
            ? "border-l-seal"
            : "border-l-transparent",
      )}
    >
      <div className="flex flex-wrap items-start gap-3">
        <DomainIcon domain={commitment.domain} size={38} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13.5px] font-medium text-ink">{commitment.title}</span>
            <StatusBadge status={commitment.status} />
            {overdue && (
              <Badge variant="danger" icon="clock">
                {commitment.daysOverdue} days waiting
              </Badge>
            )}
          </div>
          <p className={cx("mt-1.5", type_.small)}>{commitment.detail}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-ink-muted">
            <span className="flex items-center gap-1.5">
              <Icon name="users" size={13} />
              {commitment.ownerOrg}
            </span>
            <span className="flex items-center gap-1.5">
              <Icon name="calendar" size={13} />
              {`Was due on day ${commitment.dueDay}`}
            </span>
            <span className="flex items-center gap-1.5">
              <Icon name="clock" size={13} />
              {commitment.lastUpdate}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className={cx(control.secondary, "px-2.5 py-1.5 text-[12px]")}
        >
          <Icon name="document" size={14} />
          {open ? "Hide" : `${evidenceLabel} (${commitment.evidence.length})`}
          <Icon name={open ? "chevronDown" : "chevronRight"} size={13} />
        </button>
      </div>

      {open && (
        <ul className="animate-rise mt-3 space-y-2.5 border-t border-line pt-3">
          {commitment.evidence.map((item) => (
            <li key={item.id} className="flex items-start gap-2.5">
              <Icon name="link" size={14} className="mt-0.5 shrink-0 text-ink-muted" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12.5px] text-ink">{item.label}</span>
                </div>
                <p className="mt-0.5 text-[11px] text-ink-muted">
                  {`Recorded ${item.capturedAt}`}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
