"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/icons";
import {
  Avatar,
  Badge,
  Card,
  DomainIcon,
  EmptyState,
  Field,
  FlagBadge,
  Mono,
  Note,
  ProgressBar,
  StatusBadge,
  cx,
} from "@/components/ui/primitives";
import { fieldLabel } from "@/design/copy";
import { control, layout, surface, type as type_ } from "@/design/tokens";
import { useDemo } from "@/lib/demo-store";
import { AGENTS_BY_ID } from "@/lib/mock/agents";
import { AUTHORITY_GRANT, PRIMARY_CASE_ID } from "@/lib/mock/cases";
import { EDUCATION_PROJECTION } from "@/lib/mock/policy";
import { useViewer } from "@/lib/viewer";
import type { Commitment } from "@/lib/types";

export default function CaseDetailPage() {
  const params = useParams<{ caseId: string }>();
  const caseId = params?.caseId ?? PRIMARY_CASE_ID;
  const { step, setStep, commitments, cases, meta } = useDemo();
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

      <section className={cx(surface.card, "px-5 py-5")}>
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

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          icon="check"
          title={copy.caseDetail.permitted.title}
          subtitle={copy.caseDetail.permitted.subtitle}
        >
          <ul className="space-y-2">
            {AUTHORITY_GRANT.scope.map((scope) => (
              <li key={scope} className="flex items-start gap-2.5">
                <Icon name="check" size={15} className="mt-0.5 shrink-0 text-brand" />
                {showsTechnical ? (
                  <Mono className="text-ink">{scope}</Mono>
                ) : (
                  <span className="text-[13px] text-ink">
                    {PLAIN_SCOPES[scope] ?? scope.replace(/_/g, " ")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>

        <Card
          icon="close"
          title={copy.caseDetail.excluded.title}
          subtitle={copy.caseDetail.excluded.subtitle}
        >
          <ul className="space-y-2">
            {AUTHORITY_GRANT.excluded.map((scope) => (
              <li key={scope} className="flex items-start gap-2.5">
                <Icon name="close" size={15} className="mt-0.5 shrink-0 text-danger" />
                {showsTechnical ? (
                  <Mono>{scope}</Mono>
                ) : (
                  <span className="text-[13px] text-ink-soft">
                    {PLAIN_SCOPES[scope] ?? scope.replace(/_/g, " ")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card
        icon="cases"
        title={copy.caseDetail.commitments.title}
        subtitle={copy.caseDetail.commitments.subtitle}
        action={
          <div className="flex w-40 items-center gap-3">
            <ProgressBar value={closed} total={commitments.length} variant="seal" />
          </div>
        }
        bodyClassName="px-3 py-3"
      >
        <ol className="grid gap-2 2xl:grid-cols-2">
          {commitments.map((commitment) => (
            <CommitmentRow
              key={commitment.id}
              commitment={commitment}
              technical={showsTechnical}
              evidenceLabel={copy.caseDetail.evidenceLabel}
            />
          ))}
        </ol>
      </Card>

      {isPrimary && step >= 4 && (
        <Card
          icon="gateway"
          title={copy.caseDetail.projection.title}
          subtitle={copy.caseDetail.projection.subtitle}
          action={showsTechnical ? <Mono>verify_school_enrollment</Mono> : undefined}
        >
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-control border border-brand/20 bg-brand-soft px-4 py-3">
              <p className="flex items-center gap-1.5 text-[11px] font-medium tracking-[0.08em] text-brand-deep uppercase">
                <Icon name="check" size={13} />
                {copy.caseDetail.disclosedLabel} · {EDUCATION_PROJECTION.disclosed.length}
              </p>
              <ul className="mt-2.5 space-y-1.5">
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
            </div>
            <div className="rounded-control border border-danger/20 bg-danger-soft px-4 py-3">
              <p className="flex items-center gap-1.5 text-[11px] font-medium tracking-[0.08em] text-danger uppercase">
                <Icon name="close" size={13} />
                {copy.caseDetail.withheldLabel} · {EDUCATION_PROJECTION.withheld.length}
              </p>
              <ul className="mt-2.5 space-y-2">
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
            </div>
          </div>
          <div className="mt-3">
            <Note icon="shield">{copy.caseDetail.projectionNote}</Note>
          </div>
        </Card>
      )}

      {isPrimary && step >= 7 && (
        <Card
          icon="users"
          title={copy.caseDetail.handoff.title}
          subtitle={copy.caseDetail.handoff.subtitle}
        >
          <div className="grid gap-3 lg:grid-cols-2">
            <div className={cx(surface.inset, "px-4 py-3")}>
              <p className="text-[13px] font-medium text-ink">
                {showsTechnical ? "Persisted" : "Carries over to the next volunteer"}
              </p>
              <ul className="mt-2 space-y-1.5">
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
            </div>
            <div className={cx(surface.inset, "px-4 py-3")}>
              <p className="text-[13px] font-medium text-ink">
                {showsTechnical ? "Revoked at rotation" : "Stops immediately"}
              </p>
              <ul className="mt-2 space-y-1.5">
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
            </div>
          </div>
        </Card>
      )}

      {!isPrimary && (
        <Note icon="clock">
          The walkthrough only drives {PRIMARY_CASE_ID}. This one is a fixed example for context.
          Currently at {meta.dayLabel} · {meta.label}.
        </Note>
      )}
    </div>
  );
}

const PLAIN_SCOPES: Record<string, string> = {
  monitor_commitment_status: "Keep track of whether each step is done",
  request_enrollment_verification: "Ask the school to confirm she is enrolled",
  draft_escalation_for_human_approval: "Write a follow-up message for you to approve",
  placement_decision: "Decide where she lives",
  clinical_decision: "Decide what medical care she gets",
  legal_strategy: "Decide how her case is argued",
  eligibility_determination: "Decide what services she qualifies for",
};

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
      className={cx("mt-4 flex flex-wrap items-center gap-3 rounded-control border px-4 py-3.5", skin)}
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
        "rounded-control border px-4 py-3.5 transition-colors",
        overdue
          ? "border-danger/25 bg-danger-soft"
          : commitment.status === "completed"
            ? "border-seal/20 bg-seal-soft"
            : "border-line bg-surface-soft",
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
