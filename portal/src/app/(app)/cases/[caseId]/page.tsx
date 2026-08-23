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
import { AGENTS_BY_ID } from "@/lib/mock/agents";
import { AUTHORITY_GRANT, PRIMARY_CASE_ID } from "@/lib/mock/cases";
import { EDUCATION_PROJECTION } from "@/lib/mock/policy";
import { useViewer } from "@/lib/viewer";
import type { Commitment } from "@/lib/types";

export default function CaseDetailPage() {
  const params = useParams<{ caseId: string }>();
  const caseId = params?.caseId ?? PRIMARY_CASE_ID;
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

      {/* Clipped so the action band below can bleed to the card's rounded edges. */}
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
    // A band across the foot of the card rather than a bordered box inside it:
    // the tint still marks it as needing a person, without a second outline.
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
    // State reads off a rule down the leading edge instead of a fill and an
    // outline. The transparent case keeps every row on the same text baseline.
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
