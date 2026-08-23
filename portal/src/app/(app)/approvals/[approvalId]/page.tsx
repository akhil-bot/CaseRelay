"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/icons";
import {
  Avatar,
  Badge,
  Card,
  EmptyState,
  Field,
  Group,
  Mono,
  cx,
} from "@/components/ui/primitives";
import { fieldLabel, purposeLabel } from "@/design/copy";
import { control, layout, surface, type as type_ } from "@/design/tokens";
import { useDemo } from "@/lib/demo-store";
import { deriveApprovalOutcome } from "@/lib/derive";
import { APPROVALS } from "@/lib/mock/approvals";
import { useViewer } from "@/lib/viewer";

/**
 * One held action, in full, with the decision on it.
 *
 * The queue is a worklist and stays scannable; this is where the wording, the
 * disclosed field set, and the evidence actually get read. Approving sends a
 * message to another organization about a child, so nothing here is behind a
 * disclosure the reader has to think to open — the draft is shown by default and
 * the two lists sit beside it.
 */
export default function ApprovalDetailPage() {
  const params = useParams<{ approvalId: string }>();
  const approvalId = params?.approvalId ?? "";
  const { step, decisions, decide } = useDemo();
  const { copy, showsTechnical, profile } = useViewer();
  const [showDraft, setShowDraft] = useState(true);

  const approval = APPROVALS.find((item) => item.id === approvalId);
  const outcome = approval ? deriveApprovalOutcome(approval, step, decisions) : undefined;

  // An id that does not resolve, and one that has not been raised at this point
  // on the scenario clock, are the same thing to the person reading: there is
  // nothing here to approve.
  if (!approval || outcome === undefined || outcome === "not_yet_raised") {
    return (
      <Card icon="approvals" title="Not found">
        <EmptyState
          icon="search"
          title={`Nothing here is waiting under ${approvalId || "that reference"}.`}
          hint="It may have been decided already, or not raised yet."
        />
        <div className="mt-4 flex justify-center">
          <Link href="/approvals" className={control.primary}>
            Back to the queue
          </Link>
        </div>
      </Card>
    );
  }

  const elevated = approval.urgency === "elevated";
  const decided = outcome !== "pending";

  return (
    <div className={layout.stack}>
      <nav className="flex items-center gap-1.5 text-[12px] text-ink-muted">
        <Link href="/approvals" className="transition-colors hover:text-ink">
          {copy.pages.approvals.title}
        </Link>
        <Icon name="chevronRight" size={13} />
        <span className="text-ink-soft">
          {showsTechnical ? approval.id : approval.childAlias}
        </span>
      </nav>

      {/* Clipped so the decision band can bleed to the card's rounded edges. */}
      <section className={cx(surface.card, "overflow-hidden px-5 py-5")}>
        <div className="flex flex-wrap items-start gap-4">
          <Avatar name={approval.childAlias} size={48} variant={elevated ? "warn" : "accent"} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {showsTechnical && <Mono className="text-brand-deep">{approval.id}</Mono>}
              <Badge variant="accent" icon="user">
                {showsTechnical ? "Held for human principal" : "Needs your approval"}
              </Badge>
              {elevated && (
                <Badge variant="warn" icon="alert">
                  {showsTechnical ? "Elevated" : "Overdue"}
                </Badge>
              )}
            </div>
            <h2 className={cx("mt-2 text-[18px] leading-snug font-semibold text-ink", layout.measure)}>
              {approval.action}
            </h2>
            <p className={cx("mt-1.5", type_.meta)}>
              {showsTechnical
                ? `${approval.caseId} · ${approval.childAlias} · raised ${approval.createdAt}`
                : `${approval.childAlias} · ${approval.caseId} · asked you on ${approval.createdAt}`}
            </p>
          </div>
          <Link
            href={`/cases/${approval.caseId}`}
            className={cx(control.secondary, "shrink-0 px-2.5 py-1.5 text-[12px]")}
          >
            <Icon name="cases" size={14} />
            {showsTechnical ? "Open workflow" : "Open the case"}
          </Link>
        </div>

        <dl className="mt-5 grid gap-4 border-t border-line pt-4 sm:grid-cols-2 xl:grid-cols-4">
          <Field label={showsTechnical ? "Recipient" : "Goes to"}>{approval.recipient}</Field>
          <Field label={showsTechnical ? "Recipient type" : "Their role"}>
            {approval.recipientRole}
          </Field>
          <Field label={showsTechnical ? "Authorized purpose" : "Why"}>
            {showsTechnical ? (
              <Mono>{approval.purpose}</Mono>
            ) : (
              purposeLabel(approval.purpose, false)
            )}
          </Field>
          <Field label={showsTechnical ? "Requested by" : "Drafted by"}>
            {showsTechnical ? <Mono>{approval.requestedBy}</Mono> : "CaseRelay"}
          </Field>
        </dl>

        <DecisionBand
          decided={decided}
          outcome={outcome}
          actingAs={showsTechnical ? "Dana Whitfield" : profile.name}
          onDecide={(decision) => decide(approval.id, decision)}
        />
      </section>

      <Card
        icon="document"
        title={showsTechnical ? "Drafted payload" : "The message that will be sent"}
        subtitle={
          showsTechnical
            ? "Verbatim, as it will be dispatched if approved."
            : "Word for word. Nothing is added after you approve it."
        }
        action={
          <button
            type="button"
            onClick={() => setShowDraft((value) => !value)}
            aria-expanded={showDraft}
            className={cx(control.secondary, "px-2.5 py-1.5 text-[12px]")}
          >
            <Icon name={showDraft ? "chevronDown" : "chevronRight"} size={14} />
            {showDraft ? "Hide" : "Show"}
          </button>
        }
      >
        {showDraft ? (
          // A verbatim payload is the one thing that still earns a container.
          <pre
            className={cx(
              surface.inset,
              "thin-scroll animate-rise overflow-x-auto px-4 py-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-ink-soft",
            )}
          >
            {approval.draft}
          </pre>
        ) : (
          <p className={type_.meta}>Hidden. Nothing is sent until you have read it.</p>
        )}
      </Card>

      <Card
        icon="gateway"
        title={showsTechnical ? "Computed projection" : "Exactly what this shares"}
        subtitle={
          showsTechnical
            ? "Minimum-necessary field set for the authorized purpose, with the rule that withheld each excluded field."
            : "The message carries the left-hand list and nothing else."
        }
      >
        <div className="grid gap-5 lg:grid-cols-2">
          <Group
            variant="brand"
            icon="check"
            label={copy.approvals.disclosedLabel}
            count={approval.projection.disclosed.length}
          >
            <ul className="space-y-1.5">
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
          </Group>
          <Group
            variant="danger"
            icon="close"
            label={copy.approvals.withheldLabel}
            count={approval.projection.withheld.length}
          >
            <ul className="space-y-2">
              {approval.projection.withheld.map((entry) => (
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
      </Card>

      <Card
        icon="audit"
        title={showsTechnical ? "Evidence" : "What this is based on"}
        subtitle={
          showsTechnical
            ? `Applied rules ${approval.policyBasis.join(" · ")}.`
            : "Every claim in the message traces to one of these."
        }
      >
        <ul className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
          {approval.evidence.map((item) => (
            <li key={item.id} className="flex items-start gap-2.5">
              <Icon name="link" size={14} className="mt-0.5 shrink-0 text-ink-muted" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {showsTechnical && <Mono className="text-brand-deep">{item.id}</Mono>}
                  <span className="text-[12.5px] text-ink">{item.label}</span>
                </div>
                <p className="mt-0.5 text-[11px] text-ink-muted">
                  {showsTechnical ? (
                    <span className="font-mono break-all">
                      {item.source} · confidence {item.confidence.toFixed(2)}
                    </span>
                  ) : (
                    `Recorded ${item.capturedAt}`
                  )}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

/**
 * The decision, as a band across the foot of the request rather than a bordered
 * box inside it — and once it is made, the same band states the outcome, so the
 * page never looks as though it is still asking.
 */
function DecisionBand({
  decided,
  outcome,
  actingAs,
  onDecide,
}: {
  decided: boolean;
  outcome: "pending" | "approved" | "declined";
  actingAs: string;
  onDecide: (decision: "approved" | "declined") => void;
}) {
  const { copy } = useViewer();

  if (decided) {
    const approved = outcome === "approved";
    return (
      <div
        className={cx(
          "-mx-5 -mb-5 mt-5 flex flex-wrap items-center gap-3 border-t px-5 py-4",
          approved ? "border-seal/25 bg-seal-soft" : "border-danger/25 bg-danger-soft",
        )}
      >
        <Icon
          name={approved ? "checkCircle" : "close"}
          size={18}
          className={cx("shrink-0", approved ? "text-seal" : "text-danger")}
        />
        <p className="min-w-0 flex-1 text-[13px] font-medium text-ink">
          {approved ? "You approved this. It has been sent." : "You said no. Nothing was sent."}
        </p>
        <Link href="/approvals" className={control.secondary}>
          Back to the queue
          <Icon name="arrowRight" size={15} />
        </Link>
      </div>
    );
  }

  return (
    <div className="-mx-5 -mb-5 mt-5 flex flex-wrap items-center gap-3 border-t border-accent/25 bg-accent-soft px-5 py-4">
      <Icon name="user" size={18} className="shrink-0 text-accent-deep" />
      <p className={cx("min-w-0 flex-1", type_.meta)}>
        {copy.approvals.actingAs} <span className="font-medium text-ink">{actingAs}</span>
      </p>
      <div className="flex gap-2">
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
  );
}
