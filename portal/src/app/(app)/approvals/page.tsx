"use client";

import { useState } from "react";
import { Icon } from "@/components/icons";
import { Avatar, Badge, Card, EmptyState, Field, Mono, Note, cx } from "@/components/ui/primitives";
import { fieldLabel } from "@/design/copy";
import { control, layout, surface, type as type_ } from "@/design/tokens";
import { useDemo } from "@/lib/demo-store";
import { deriveApprovalOutcome } from "@/lib/derive";
import { APPROVALS } from "@/lib/mock/approvals";
import { POISONED_PAYLOAD, POLICY_RULES } from "@/lib/mock/policy";
import { useViewer } from "@/lib/viewer";
import type { ApprovalRequest } from "@/lib/types";

export default function ApprovalsPage() {
  const { step, decisions, decide } = useDemo();
  const { copy, showsTechnical } = useViewer();

  const rows = APPROVALS.map((approval) => ({
    approval,
    outcome: deriveApprovalOutcome(approval, step, decisions),
  })).filter((row) => row.outcome !== "not_yet_raised");

  const pending = rows.filter((row) => row.outcome === "pending");
  const settled = rows.filter((row) => row.outcome !== "pending");
  const empty = copy.approvals.empty(step >= 6);

  return (
    <div className={layout.stack}>
      <Card
        icon="approvals"
        title={copy.approvals.queue.title}
        subtitle={copy.approvals.queue.subtitle}
        action={<Badge variant={pending.length > 0 ? "accent" : "neutral"}>{pending.length}</Badge>}
        bodyClassName={pending.length > 0 ? "px-3 py-3" : undefined}
      >
        {pending.length === 0 ? (
          <EmptyState icon="checkCircle" title={empty.title} hint={empty.hint} />
        ) : (
          <div className="space-y-3">
            {pending.map(({ approval }) => (
              <ApprovalCard
                key={approval.id}
                approval={approval}
                onDecide={(decision) => decide(approval.id, decision)}
              />
            ))}
          </div>
        )}
      </Card>

      {step >= 5 && (
        <Card
          icon="lock"
          title={copy.approvals.context.title}
          subtitle={copy.approvals.context.subtitle}
        >
          {showsTechnical ? (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="danger" icon="shield">
                    Model Armor · quarantined
                  </Badge>
                  <Mono className="text-[11.5px]">evt-2051</Mono>
                </div>
                <pre className="thin-scroll mt-2.5 overflow-x-auto rounded-control border border-danger/20 bg-danger-soft px-4 py-3 font-mono text-[11.5px] leading-relaxed text-ink-soft">
                  {POISONED_PAYLOAD}
                </pre>
                <p className={cx("mt-2.5", layout.measure, type_.small)}>
                  The instruction to fetch <Mono>health.immunization_records</Mono> and{" "}
                  <Mono>legal.hearing_summary</Mono> was refused under <Mono>POL-INJ-002</Mono>. The
                  Safeguarding Verifier recorded every withheld field and issued a policy-compliant
                  retry using the same idempotency key.
                </p>
              </div>
              <div className={cx(surface.inset, "px-4 py-3.5")}>
                <p className={type_.label}>Safe retry</p>
                <dl className="mt-3 space-y-3">
                  <Field label="Attempt">1 of 3 bounded retries</Field>
                  <Field label="Idempotency key">
                    <Mono>idem-2048</Mono>
                  </Field>
                  <Field label="Projection">Unchanged 5-field enrollment scope</Field>
                  <Field label="Result">
                    <Mono>unresolved</Mono> — transfer packet not routed to a registrar
                  </Field>
                </dl>
              </div>
            </div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
              <div>
                <Badge variant="danger" icon="shield">
                  Request refused
                </Badge>
                <p className={cx("mt-2.5", layout.measure, type_.body)}>
                  The school office replied asking CaseRelay to send Maya&apos;s immunisation records
                  and a summary of her court hearing before they would answer. CaseRelay refused. It
                  is not allowed to share either of those with a school, and it did not ask you to
                  overrule that.
                </p>
                <p className={cx("mt-2.5", layout.measure, type_.body)}>
                  It then asked the same enrollment question again, wording it correctly. The school
                  still has not replied, which is why it is now asking you to send a follow-up.
                </p>
              </div>
              <div className={cx(surface.inset, "px-4 py-3.5")}>
                <p className={type_.label}>What was refused</p>
                <ul className="mt-3 space-y-2">
                  {["Her immunisation records", "What happened at her hearing"].map((item) => (
                    <li key={item} className="flex items-start gap-2 text-[12.5px] text-ink-soft">
                      <Icon name="close" size={14} className="mt-0.5 shrink-0 text-danger" />
                      {item}
                    </li>
                  ))}
                </ul>
                <p className={cx("mt-3", type_.meta)}>
                  Asking again did not risk sending the same message twice — CaseRelay tracks that
                  for you.
                </p>
              </div>
            </div>
          )}
        </Card>
      )}

      {settled.length > 0 && (
        <Card
          icon="audit"
          title={copy.approvals.history.title}
          subtitle={copy.approvals.history.subtitle || undefined}
          bodyClassName="px-3 py-3"
        >
          <ul className="grid gap-2 2xl:grid-cols-2 3xl:grid-cols-3">
            {settled.map(({ approval, outcome }) => (
              <li key={approval.id} className={cx(surface.inset, "px-4 py-3")}>
                <div className="flex flex-wrap items-center gap-2">
                  {showsTechnical && <Mono className="text-brand-deep">{approval.id}</Mono>}
                  <span className="text-[13px] text-ink">{approval.action}</span>
                  <Badge
                    variant={outcome === "approved" ? "seal" : "danger"}
                    icon={outcome === "approved" ? "checkCircle" : "close"}
                    className="ml-auto"
                  >
                    {outcome === "approved"
                      ? showsTechnical
                        ? "Approved · dispatched"
                        : "You approved this"
                      : showsTechnical
                        ? "Denied"
                        : "You said no"}
                  </Badge>
                </div>
                <p className={cx("mt-1.5", type_.meta)}>
                  {showsTechnical
                    ? `${approval.caseId} · ${approval.childAlias} · raised ${approval.createdAt} · ${approval.projection.disclosed.length} disclosed, ${approval.projection.withheld.length} withheld`
                    : `${approval.childAlias} · asked you on ${approval.createdAt} · shared ${approval.projection.disclosed.length} details, held back ${approval.projection.withheld.length}`}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card
        icon="shield"
        title={copy.approvals.rules.title}
        subtitle={copy.approvals.rules.subtitle}
        bodyClassName="px-3 py-3"
      >
        <ul className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3 3xl:grid-cols-4">
          {POLICY_RULES.map((rule) => (
            <li key={rule.id} className={cx(surface.inset, "px-3.5 py-3")}>
              <div className="flex items-center gap-2">
                {showsTechnical && <Mono className="text-brand-deep">{rule.id}</Mono>}
                <span className="text-[12.5px] font-medium text-ink">
                  {showsTechnical ? rule.title : PLAIN_RULES[rule.id]?.title ?? rule.title}
                </span>
              </div>
              <p className={cx("mt-1", type_.meta)}>
                {showsTechnical ? rule.summary : PLAIN_RULES[rule.id]?.summary ?? rule.summary}
              </p>
            </li>
          ))}
        </ul>
      </Card>

      <Note icon={showsTechnical ? "sparkle" : "shield"}>{copy.approvals.footnote}</Note>
    </div>
  );
}

const PLAIN_RULES: Record<string, { title: string; summary: string }> = {
  "POL-MIN-001": {
    title: "Only what the question needs",
    summary:
      "Whoever is asked a question is told only what that question needs. Nothing else is included.",
  },
  "POL-INJ-002": {
    title: "Outside messages cannot give instructions",
    summary:
      "If a reply from another organization tries to tell CaseRelay what to do, it is set aside and never acted on.",
  },
  "POL-IDEM-003": {
    title: "Never sent twice",
    summary: "If CaseRelay retries, the same message will not reach anyone a second time.",
  },
  "POL-AUTH-004": {
    title: "A verified court order first",
    summary: "Nothing starts until a supervisor has confirmed you are appointed to the case.",
  },
  "POL-EXP-005": {
    title: "Reasons you can read",
    summary:
      "Every refusal comes with a plain explanation and the document it was based on, so you can check it.",
  },
  "POL-OWN-006": {
    title: "Somebody is always responsible",
    summary:
      "A step with no named person responsible for it is treated as a problem, not as work in progress.",
  },
  "POL-ESC-007": {
    title: "A person approves every message out",
    summary: "CaseRelay cannot contact another organization until you have read the message and agreed.",
  },
};

function ApprovalCard({
  approval,
  onDecide,
}: {
  approval: ApprovalRequest;
  onDecide: (decision: "approved" | "declined") => void;
}) {
  const { copy, showsTechnical, profile } = useViewer();
  const [showDraft, setShowDraft] = useState(true);

  return (
    <article
      className={cx(
        "rounded-card border px-4 py-4",
        approval.urgency === "elevated"
          ? "border-accent/25 bg-accent-soft/60"
          : "border-line bg-surface-soft",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Avatar name={approval.childAlias} size={34} variant="accent" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {showsTechnical && <Mono className="text-brand-deep">{approval.id}</Mono>}
            <Badge variant="accent" icon="user">
              {showsTechnical ? "Held for human principal" : "Needs your approval"}
            </Badge>
            {approval.urgency === "elevated" && (
              <Badge variant="warn" icon="alert">
                {showsTechnical ? "Elevated" : "Overdue"}
              </Badge>
            )}
          </div>
          <p className={cx("mt-1", type_.meta)}>
            {showsTechnical
              ? `${approval.caseId} · ${approval.childAlias} · raised ${approval.createdAt}`
              : `${approval.childAlias} · ${approval.caseId} · asked you on ${approval.createdAt}`}
          </p>
        </div>
      </div>

      <h3 className="mt-3 text-[15px] font-semibold text-ink">{approval.action}</h3>

      <dl className="mt-3.5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Field label={showsTechnical ? "Recipient" : "Goes to"}>{approval.recipient}</Field>
        <Field label={showsTechnical ? "Recipient type" : "Their role"}>
          {approval.recipientRole}
        </Field>
        <Field label={showsTechnical ? "Authorized purpose" : "Why"}>
          {showsTechnical ? (
            <Mono>{approval.purpose}</Mono>
          ) : (
            "To confirm she is enrolled at school"
          )}
        </Field>
        <Field label={showsTechnical ? "Requested by" : "Drafted by"}>
          {showsTechnical ? <Mono>{approval.requestedBy}</Mono> : "CaseRelay"}
        </Field>
      </dl>

      <div className="mt-4 grid gap-3 lg:grid-cols-2 3xl:grid-cols-3">
        <div className="rounded-control border border-brand/20 bg-brand-soft px-4 py-3">
          <p className="flex items-center gap-1.5 text-[11px] font-medium tracking-[0.08em] text-brand-deep uppercase">
            <Icon name="check" size={13} />
            {copy.approvals.disclosedLabel} · {approval.projection.disclosed.length}
          </p>
          <ul className="mt-2.5 space-y-1">
            {approval.projection.disclosed.map((field) => (
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
            {copy.approvals.withheldLabel} · {approval.projection.withheld.length}
          </p>
          <ul className="mt-2.5 space-y-1">
            {approval.projection.withheld.map((entry) => (
              <li key={entry.field} className="flex flex-wrap items-baseline gap-x-2">
                {showsTechnical ? (
                  <>
                    <Mono className="line-through decoration-danger/50">{entry.field}</Mono>
                    <Mono className="text-[10.5px]">{entry.ruleId}</Mono>
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

        <div className="rounded-control border border-line bg-surface px-4 py-3 lg:col-span-2 3xl:col-span-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className={cx("flex items-center gap-1.5", type_.label)}>
              <Icon name="document" size={13} />
              {showsTechnical ? "Evidence" : "What this is based on"} · {approval.evidence.length}
            </p>
            {showsTechnical && (
              <Mono className="text-[11px]">policy basis {approval.policyBasis.join(" · ")}</Mono>
            )}
          </div>
          <ul className="mt-2.5 space-y-2">
            {approval.evidence.map((item) => (
              <li key={item.id} className="flex items-start gap-2.5">
                <Icon name="link" size={13} className="mt-1 shrink-0 text-ink-muted" />
                <div className="min-w-0">
                  <p className="text-[12.5px] text-ink">{item.label}</p>
                  {showsTechnical && (
                    <p className="font-mono text-[11px] break-all text-ink-muted">
                      {item.source} · confidence {item.confidence.toFixed(2)}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-3">
        <button
          type="button"
          onClick={() => setShowDraft((value) => !value)}
          aria-expanded={showDraft}
          className="flex items-center gap-1.5 text-[12.5px] font-medium text-brand-deep"
        >
          <Icon name={showDraft ? "chevronDown" : "chevronRight"} size={14} />
          {showDraft
            ? "Hide the message"
            : showsTechnical
              ? "Show drafted payload"
              : "Read the message first"}
        </button>
        {showDraft && (
          <pre className="thin-scroll animate-rise mt-2 overflow-x-auto rounded-control border border-line bg-surface px-4 py-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-ink-soft">
            {approval.draft}
          </pre>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-3.5">
        <span className={cx("flex items-center gap-1.5", type_.meta)}>
          <Icon name="user" size={14} />
          {copy.approvals.actingAs}{" "}
          <span className="font-medium text-ink">
            {showsTechnical ? "Dana Whitfield" : profile.name}
          </span>
        </span>
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={() => onDecide("declined")} className={control.secondary}>
            <Icon name="close" size={15} />
            {copy.approvals.declineLabel}
          </button>
          <button type="button" onClick={() => onDecide("approved")} className={control.primary}>
            <Icon name="check" size={15} />
            {copy.approvals.approveLabel}
          </button>
        </div>
      </div>
    </article>
  );
}
