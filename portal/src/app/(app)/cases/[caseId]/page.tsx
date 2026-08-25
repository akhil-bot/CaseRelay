"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { LiveActivityFeed } from "@/components/live/LiveActivityFeed";
import {
  Avatar,
  Badge,
  Card,
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
import { fieldLabel } from "@/design/copy";
import { control, layout, row, surface, type as type_ } from "@/design/tokens";
import { useDemo } from "@/lib/demo-store";
import { submitRun, type RunEvent } from "@/lib/api";
import { useLiveCase, useLiveRunEvents } from "@/lib/live-case";
import { AGENTS_BY_ID } from "@/lib/mock/agents";
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

function LiveCaseDetail({ caseId }: { caseId: string }) {
  const liveCase = useLiveCase(caseId);
  const { showsTechnical } = useViewer();

  const latestRunId = useMemo(() => {
    if (liveCase.status !== "loaded") return null;
    const activeRun = liveCase.runs.find(
      (r) => r.state === "running" || r.state === "queued",
    );
    if (activeRun) return activeRun.run_id;
    return liveCase.runs[0]?.run_id ?? null;
  }, [liveCase]);

  const runState = useLiveRunEvents(latestRunId);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [manualRunId, setManualRunId] = useState<string | null>(null);

  const manualRunState = useLiveRunEvents(
    manualRunId && manualRunId !== latestRunId ? manualRunId : null,
  );

  const activeRunState = manualRunId && manualRunId !== latestRunId
    ? manualRunState
    : runState;

  const quarantineCompleted = useMemo(() =>
    activeRunState.events.filter((ev: RunEvent) =>
      ev.event === "phase_complete" && (ev.phase ?? "").includes("quarantine"),
    ),
  [activeRunState.events]);

  const quarantineErrors = useMemo(() =>
    activeRunState.events.filter((ev: RunEvent) =>
      ev.event === "phase_error" && (ev.phase ?? "").includes("quarantine"),
    ),
  [activeRunState.events]);

  const escalationCompleted = useMemo(() =>
    activeRunState.events.filter((ev: RunEvent) =>
      ev.event === "phase_complete" && (ev.phase ?? "").includes("approve"),
    ),
  [activeRunState.events]);

  const handleRun = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const ref = await submitRun(caseId);
      setManualRunId(ref.run_id);
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
            <span className={type_.body}>Loading case from control plane…</span>
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
                Failed to load case from the control plane
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

  const { data, runs } = liveCase;
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
  const isStreaming = activeRunState.streaming || hasActiveRun;

  return (
    <div className={layout.stack}>
      <Breadcrumb label={showsTechnical ? caseId : childName} />

      <section className={cx(surface.card, "overflow-hidden px-5 py-5")}>
        <div className="flex flex-wrap items-start gap-4">
          <Avatar name={childName} size={52} variant="brand" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[18px] font-semibold text-ink">
                {showsTechnical ? caseId : childName}
              </h2>
              <Mono className="text-[12px]">
                {showsTechnical ? childName : caseId}
              </Mono>
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
            {status}
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
            {status}
          </Field>
          <Field label="Commitments">
            {closedCount} of {commitmentEntries.length} closed
          </Field>
        </dl>

        {!hasActiveRun && !activeRunState.streaming && (
          <div
            className={cx(
              "-mx-5 -mb-5 mt-5 flex flex-wrap items-center gap-3 border-t px-5 py-4",
              "border-brand/25 bg-brand-soft text-brand",
            )}
          >
            <Icon name="play" size={18} className="shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium">
                {runs.length === 0 ? "No runs yet" : "Start a new run"}
              </p>
              <p className="mt-0.5 text-[12px] text-ink-soft">
                Run the agent fleet against this case to see live multi-agent execution.
              </p>
            </div>
            <button
              type="button"
              onClick={handleRun}
              disabled={submitting}
              className={control.primary}
            >
              <Icon name="play" size={15} />
              {submitting ? "Starting…" : "Run the fleet"}
            </button>
          </div>
        )}
        {submitError && (
          <p className="mt-2 text-[12px] text-danger">{submitError}</p>
        )}
      </section>

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
                    <span className="text-[13.5px] font-medium text-ink capitalize">
                      {type.replace("_", " ")}
                    </span>
                  </div>
                  <StatusBadge status={commitmentStatus as CommitmentStatus} />
                </div>
              </li>
            ))}
          </Rows>
        </Card>
      )}

      {/* Quarantine / escalation highlight — only rendered when the phase
          actually completed (phase_complete), never on phase_started alone.
          All text comes from the backend's _narrate message field. */}
      {(quarantineCompleted.length > 0 || quarantineErrors.length > 0) && (
        <Card icon="lock" title="Quarantine">
          {quarantineCompleted.length > 0 && (
            <div className="rounded-control border border-danger/25 bg-danger/5 px-4 py-3">
              <div className="flex items-start gap-3">
                <Icon name="shield" size={20} className="mt-0.5 shrink-0 text-danger" />
                <div>
                  {quarantineCompleted.map((ev, i) => (
                    <p key={i} className={cx("text-[13px]", i === 0 ? "font-medium text-danger" : "mt-1 text-ink-soft")}>
                      {String(ev.message ?? ev.event)}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          )}
          {quarantineErrors.length > 0 && (
            <div className={cx(quarantineCompleted.length > 0 && "mt-3", "rounded-control border border-danger/25 bg-danger/5 px-4 py-3")}>
              <div className="flex items-start gap-3">
                <Icon name="alert" size={20} className="mt-0.5 shrink-0 text-danger" />
                <div>
                  {quarantineErrors.map((ev, i) => (
                    <p key={i} className="text-[13px] text-danger">
                      {String(ev.message ?? ev.error ?? ev.event)}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          )}
          {escalationCompleted.length > 0 && (
            <div className="mt-3 rounded-control border border-warn/25 bg-warn-soft px-4 py-3">
              <div className="flex items-start gap-3">
                <Icon name="user" size={20} className="mt-0.5 shrink-0 text-warn" />
                <div>
                  {escalationCompleted.map((ev, i) => (
                    <p key={i} className={cx("text-[13px]", i === 0 ? "font-medium text-warn" : "mt-1 text-ink-soft")}>
                      {String(ev.message ?? ev.event)}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Live activity feed */}
      {(isStreaming || activeRunState.events.length > 0) && (
        <LiveActivityFeed run={activeRunState} />
      )}

      {/* Audit trail (from initial case fetch) */}
      {data.timeline.length > 0 && (
        <Card icon="audit" title="Audit Trail" subtitle={`${data.timeline.length} events`} flush>
          <Rows>
            {data.timeline.map((entry, i) => {
              const e = entry as Record<string, string>;
              return (
                <li key={i} className={cx(row.pad, "flex items-start gap-3")}>
                  <Icon name="document" size={14} className="mt-1 shrink-0 text-ink-muted" />
                  <div className="min-w-0 flex-1">
                    <span className="text-[12.5px] font-medium text-ink">
                      {e.event_type ?? e.type ?? "event"}
                    </span>
                    {e.agent_identity && (
                      <Mono className="ml-2 text-[11px] text-ink-muted">
                        {e.agent_identity}
                      </Mono>
                    )}
                    {(e.detail || e.explanation) && (
                      <p className={cx("mt-0.5", type_.meta)}>{e.detail || e.explanation}</p>
                    )}
                  </div>
                  {e.timestamp && (
                    <span className="shrink-0 font-mono text-[10px] text-ink-muted">
                      {e.timestamp}
                    </span>
                  )}
                </li>
              );
            })}
          </Rows>
        </Card>
      )}
    </div>
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

// ═══════════════════════════════════════════════════════════════════════════
// Mock case detail — the scripted walkthrough (unchanged from before)
// ═══════════════════════════════════════════════════════════════════════════

function MockCaseDetail({ caseId }: { caseId: string }) {
  const { step, setStep, commitments, cases } = useDemo();
  const { copy, showsTechnical } = useViewer();
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
          {showsTechnical ? "Workflows" : "My cases"}
        </Link>
        <Icon name="chevronRight" size={13} />
        <span className="text-ink-soft">{showsTechnical ? record.id : record.childAlias}</span>
      </nav>

      <section className={cx(surface.card, "overflow-hidden px-5 py-5")}>
        <div className="flex flex-wrap items-start gap-4">
          <Avatar name={record.childAlias} size={52} variant={activated ? "brand" : "neutral"} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[18px] font-semibold text-ink">
                {showsTechnical ? record.id : record.childAlias}
              </h2>
              <Mono className="text-[12px]">
                {showsTechnical ? record.childAlias : record.id}
              </Mono>
              {record.flags.map((flag) => (
                <FlagBadge key={flag} flag={flag} />
              ))}
            </div>
            <p className={cx("mt-1.5", layout.measure, type_.body)}>{record.headline}</p>
          </div>
          <Badge variant={activated ? "brand" : "warn"} icon={activated ? "check" : "clock"}>
            {activated
              ? showsTechnical
                ? "Monitoring active"
                : "CaseRelay is watching this"
              : showsTechnical
                ? "Not activated"
                : "Not started yet"}
          </Badge>
        </div>

        <dl className="mt-5 grid gap-4 border-t border-line pt-4 sm:grid-cols-2 xl:grid-cols-4">
          <Field label={showsTechnical ? "Authority reference" : "Court order"}>
            <Mono>{record.courtOrder}</Mono>
          </Field>
          <Field label={showsTechnical ? "Appointed principal" : "Advocate"}>
            {record.volunteer}
          </Field>
          <Field label={showsTechnical ? "Approving principal" : "Your supervisor"}>
            {record.supervisor}
          </Field>
          <Field label={showsTechnical ? "Authority grant" : "Permission expires"}>
            {showsTechnical ? (
              <>
                <Mono>{AUTHORITY_GRANT.id}</Mono>{" "}
                <span className="text-ink-muted">expires {AUTHORITY_GRANT.expiresOn}</span>
              </>
            ) : (
              AUTHORITY_GRANT.expiresOn
            )}
          </Field>
        </dl>

        {isPrimary && step === 0 && (
          <ActionBar
            variant="warn"
            icon="lock"
            title={
              showsTechnical
                ? "Held by POL-AUTH-004 pending a human principal"
                : "Your supervisor needs to confirm the court order"
            }
            body={
              showsTechnical
                ? "The Intake Agent proposed five commitments. Activation requires a verified authority grant."
                : "CaseRelay has read the referral and listed five next steps. It will not start chasing anyone until a supervisor confirms the court appointment."
            }
            cta={showsTechnical ? "Record authority and activate" : "Confirm and start watching"}
            onAct={() => setStep(1)}
          />
        )}

        {isPrimary && step === 3 && (
          <ActionBar
            variant="accent"
            icon="sleep"
            title={
              showsTechnical
                ? "Workflow suspended at checkpoint c-0007"
                : "Nothing is due right now"
            }
            body={
              showsTechnical
                ? "No process is running and no session is held open. A scheduled deadline event resumes it."
                : "CaseRelay has gone quiet on purpose. It will wake itself up when a date passes — you do not have to remember."
            }
            cta={showsTechnical ? "Fire the Day 17 deadline event" : "Jump ahead to day 17"}
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
              technical={showsTechnical}
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
          action={showsTechnical ? <Mono>verify_school_enrollment</Mono> : undefined}
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
                    {showsTechnical ? (
                      <Mono className="text-ink">{field}</Mono>
                    ) : (
                      <span className="text-[12.5px] text-ink">{fieldLabel(field, false)}</span>
                    )}
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
                    {showsTechnical ? (
                      <>
                        <Mono className="line-through decoration-danger/50">{entry.field}</Mono>
                        <p className="text-[11.5px] text-ink-muted">
                          {entry.reason} <Mono className="text-[11px]">{entry.ruleId}</Mono>
                        </p>
                      </>
                    ) : (
                      <span className="text-[12.5px] text-ink-soft line-through decoration-danger/40">
                        {fieldLabel(entry.field, false)}
                      </span>
                    )}
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
              label={showsTechnical ? "Persisted" : "Carries over to the next volunteer"}
            >
              <ul className="space-y-1.5">
                {(showsTechnical
                  ? [
                      "Five commitment states with source and timestamp",
                      "Workflow checkpoint and scheduled wake timers",
                      "Named partner owners and expected response dates",
                    ]
                  : [
                      "Every step, and who is responsible for it",
                      "The dates CaseRelay is still watching for",
                      "Who to contact at each organization",
                    ]
                ).map((entry) => (
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
              label={showsTechnical ? "Revoked at rotation" : "Stops immediately"}
            >
              <ul className="space-y-1.5">
                {(showsTechnical
                  ? [
                      "Outgoing principal's session and API tokens",
                      "Read access to the referral packet in storage",
                      "Approval-queue visibility for this workflow",
                    ]
                  : [
                      "The previous volunteer's access to this case",
                      "Their ability to open the referral documents",
                      "Any approval requests still sitting with them",
                    ]
                ).map((entry) => (
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
  technical,
  evidenceLabel,
}: {
  commitment: Commitment;
  technical: boolean;
  evidenceLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const agent = AGENTS_BY_ID[commitment.ownerAgentId];
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
            {technical && <Mono className="text-[11.5px]">{commitment.id}</Mono>}
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
            {technical && agent && (
              <span className="flex items-center gap-1.5">
                <Icon name="identity" size={13} />
                <Mono className="text-[11px]">{agent.identity}</Mono>
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <Icon name="calendar" size={13} />
              {technical ? `Due Day ${commitment.dueDay}` : `Was due on day ${commitment.dueDay}`}
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
                  {technical && <Mono className="text-brand-deep">{item.id}</Mono>}
                  <span className="text-[12.5px] text-ink">{item.label}</span>
                  {technical && (
                    <Badge variant="neutral">confidence {item.confidence.toFixed(2)}</Badge>
                  )}
                </div>
                <p className="mt-0.5 text-[11px] text-ink-muted">
                  {technical ? (
                    <span className="font-mono break-all">
                      {item.source} · captured {item.capturedAt}
                    </span>
                  ) : (
                    `Recorded ${item.capturedAt}`
                  )}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
