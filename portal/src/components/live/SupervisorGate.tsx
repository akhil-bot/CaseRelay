"use client";

import Link from "next/link";
import { Icon } from "@/components/icons";
import { Badge } from "@/components/ui/primitives";
import { control, cx, surface, type as type_ } from "@/design/tokens";
import type { GateKind } from "@/lib/live-approvals";

const DAY = 86_400_000;

/**
 * How long the case has stood here, in the terms someone would say it.
 *
 * Returns null for a timestamp that is missing or unreadable, so the caller can
 * drop the fact rather than print a date it does not trust.
 */
function waitingLabel(openedAt?: string): string | null {
  if (!openedAt) return null;
  const at = Date.parse(openedAt);
  if (Number.isNaN(at)) return null;
  const days = Math.floor((Date.now() - at) / DAY);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

/**
 * A decision the case cannot move past.
 *
 * Rendered bare rather than inside a Card. It is the one thing on a page that
 * must not be skimmed past, so it carries its own border, tint and stripe and
 * looks like nothing else in the product.
 *
 * The card neither knows nor decides who is deciding: `decidingAs` is a label
 * and the identity written to the record is the caller's to supply. It is shown
 * on two screens — the case itself and the approvals queue — and only the queue
 * has to say which case a gate belongs to, hence `caseId` being optional.
 */
export function SupervisorGate({
  kind,
  childName,
  reason,
  decidingAs,
  busy,
  error,
  caseId,
  advocateName,
  commitmentCount,
  grantCount,
  organisations,
  openedAt,
  actionType,
  onOpen,
  opening = false,
  readOnly = false,
  onApprove,
  onReject,
}: {
  kind: GateKind;
  childName: string;
  reason?: string;
  decidingAs: string;
  busy: boolean;
  error?: string | null;
  /** Set only where the gate stands away from its own case, so it can link back. */
  caseId?: string;
  /**
   * The case this decision is about, in the terms the decision turns on: whose
   * case it is, how much was extracted from it, and who approving would reach.
   * All optional — a case that would not open still has a gate worth showing,
   * and a missing figure is left out rather than shown as a zero.
   */
  advocateName?: string;
  commitmentCount?: number;
  grantCount?: number;
  organisations?: string[];
  /** ISO-8601. */
  openedAt?: string;
  actionType?: string;
  /**
   * Read the case behind this gate.
   *
   * Grants and organisations are only on the case aggregate, and a queue that
   * fetched them for every gate would open every waiting case on a timer just
   * in case somebody looked. So the card asks for them when somebody does.
   */
  onOpen?: () => void;
  opening?: boolean;
  /**
   * For anyone but the supervisor. The gate still shows — an advocate opening a
   * stopped case needs to know it is stopped and why — but it names who it is
   * waiting on instead of offering a decision they cannot make.
   */
  readOnly?: boolean;
  onApprove: () => void;
  onReject?: () => void;
}) {
  const isActivation = kind === "activation";
  const subject = isActivation ? "activation" : "escalation";
  const title = readOnly
    ? `Waiting on your supervisor — ${subject} for ${childName}`
    : `Waiting on you — approve ${subject} for ${childName}`;
  const body = isActivation
    ? "CaseRelay has extracted commitments and proposed grants. Nothing will happen until you decide — no service will be contacted and no data will be shared."
    : reason ?? "A reply was quarantined. The case is paused and will not proceed until you make a decision.";
  const consequence = readOnly
    ? isActivation
      ? "Once approved, each specialist gets access to their scoped fields and outreach to the services on this case begins."
      : "Once decided, the quarantined action is either released or discarded, and the decision is recorded."
    : isActivation
      ? "Approving grants each specialist access to their scoped fields and begins outreach to all services on this case."
      : "Approving releases the quarantined action. Rejecting discards it and records your decision.";

  // A figure that is genuinely absent is left out. A zero would be a claim about
  // the case, and "0 commitments" is not why this gate is showing.
  const facts: { label: string; value: string }[] = [];
  if (isActivation) {
    if (commitmentCount !== undefined) {
      facts.push({
        label: "Commitments extracted",
        value: `${commitmentCount} ${commitmentCount === 1 ? "step" : "steps"}`,
      });
    }
    if (grantCount !== undefined) {
      facts.push({
        label: "Grants proposed",
        value: `${grantCount} ${grantCount === 1 ? "grant" : "grants"}`,
      });
    }
  } else if (actionType) {
    facts.push({ label: "Action held", value: actionType.replace(/_/g, " ") });
  }
  if (organisations && organisations.length > 0) {
    facts.push({ label: "Services on the case", value: String(organisations.length) });
  }
  const waited = waitingLabel(openedAt);
  if (waited) facts.push({ label: "Case opened", value: waited });

  return (
    <section
      className={cx(
        surface.card,
        "overflow-hidden border-2 border-warn/50",
        // Faint warm tint so the card reads as different from a normal card at a glance
        "bg-warn-soft/20",
      )}
    >
      {/* Coloured top stripe — instantly distinguishes this from any other card */}
      <div className="h-1 w-full bg-warn/40" />

      <div className="flex flex-wrap items-start gap-3 px-5 pt-5 pb-4">
        {/* Pulsing icon ring to catch the eye when the card first appears. It
            asks for an action, so it stays still for someone who has none. */}
        <span className="relative mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-warn/20">
          {!readOnly && <span className="absolute inset-0 animate-ping rounded-full bg-warn/20" />}
          <Icon name="lock" size={18} className="relative text-warn" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-ink">{title}</p>
          <p className={cx("mt-1.5", type_.body)}>{body}</p>
          <p className="mt-2 text-[12px] text-ink-soft">{consequence}</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <p className="flex items-center gap-1.5 text-[12px] text-ink-muted">
              <Icon name="users" size={13} className="shrink-0" />
              {readOnly ? "With" : "Deciding as"}{" "}
              <span className="font-medium text-ink">{decidingAs}</span>
            </p>
            {advocateName && (
              <p className="flex items-center gap-1.5 text-[12px] text-ink-muted">
                <Icon name="user" size={13} className="shrink-0" />
                Advocate <span className="font-medium text-ink">{advocateName}</span>
              </p>
            )}
            {caseId && (
              <Link
                href={`/cases/${caseId}`}
                className="flex items-center gap-1 font-mono text-[11.5px] text-ink-muted transition-colors hover:text-ink"
              >
                {caseId}
                <Icon name="chevronRight" size={13} className="shrink-0" />
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* What the decision is about.
          Only away from the case — `caseId` is the signal for that — because on
          the case itself these same figures are already stated just above, and
          restating them a second time on the card reads as an oversight. */}
      {caseId && facts.length > 0 && (
        <dl className="grid gap-x-6 gap-y-3.5 border-t border-warn/25 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
          {facts.map((fact) => (
            <div key={fact.label} className="min-w-0">
              <dt className={type_.label}>{fact.label}</dt>
              <dd className="mt-1 truncate text-[12.5px] text-ink">{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {/* Offered rather than fetched. Everything above is on the caseload
          listing already; what is behind this button is not, and reading it for
          every card on a timer is how a queue of gates turns into a burst of
          requests nobody asked for. */}
      {caseId && onOpen && organisations === undefined && (
        <div className="border-t border-warn/25 px-5 py-3.5">
          <button
            type="button"
            onClick={onOpen}
            disabled={opening}
            className={control.secondary}
            aria-label={`Show what approving covers for ${childName}`}
          >
            <Icon name={opening ? "clock" : "chevronDown"} size={15} />
            {opening ? "Reading the case…" : "What approving covers"}
          </button>
        </div>
      )}

      {/* The consequence, named. "Outreach to all services" is a phrase; these
          are the organisations that would actually be contacted. */}
      {caseId && isActivation && organisations && organisations.length > 0 && (
        <div className="border-t border-warn/25 px-5 py-4">
          <p className={type_.label}>Approving begins outreach to</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {organisations.map((org) => (
              <Badge key={org} variant="neutral">
                {org}
              </Badge>
            ))}
          </div>
        </div>
      )}
      <div
        className={cx(
          "flex flex-wrap items-center gap-3 border-t px-5 py-4",
          "border-warn/30 bg-warn-soft/50",
        )}
      >
        {readOnly ? (
          <p className="flex items-center gap-2 text-[12.5px] text-ink-soft">
            <Icon name="clock" size={14} className="shrink-0 text-warn" />
            Nothing for you to do here. You will see it move as soon as the decision is made.
          </p>
        ) : (
          <>
            {onReject && (
              <button
                type="button"
                onClick={onReject}
                disabled={busy}
                className={control.secondary}
              >
                <Icon name="close" size={15} />
                Reject
              </button>
            )}
            <button
              type="button"
              onClick={onApprove}
              disabled={busy}
              className={cx(control.primary, "ml-auto")}
            >
              <Icon name="check" size={15} />
              {busy ? "Approving…" : isActivation ? "Approve & activate" : "Approve escalation"}
            </button>
          </>
        )}
      </div>
      {error && <p className="mb-3 px-5 text-[12px] text-danger">{error}</p>}
    </section>
  );
}
