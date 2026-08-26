"use client";

import Link from "next/link";
import { Icon } from "@/components/icons";
import {
  Avatar,
  Badge,
  Card,
  EmptyState,
  Group,
  Rows,
  cx,
} from "@/components/ui/primitives";
import { ColumnHeader, TableCell } from "@/components/ui/table";
import { purposeLabel } from "@/design/copy";
import { layout, row, type as type_ } from "@/design/tokens";
import { useDemo } from "@/lib/demo-store";
import { deriveApprovalOutcome } from "@/lib/derive";
import { APPROVALS } from "@/lib/mock/approvals";
import { useViewer } from "@/lib/viewer";
import type { ApprovalRequest } from "@/lib/types";

export default function ApprovalsPage() {
  const { step, decisions } = useDemo();
  const { copy } = useViewer();

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
        action={
          pending.length > 0 ? (
            <Badge variant="accent" icon="clock">
              {pending.length === 1 ? "1 waiting on you" : `${pending.length} waiting on you`}
            </Badge>
          ) : undefined
        }
        flush={pending.length > 0}
      >
        {pending.length === 0 ? (
          <EmptyState icon="checkCircle" title={empty.title} hint={empty.hint} />
        ) : (
          <>
            <ColumnHeader labels={QUEUE_LABELS(copy)} track={COLUMNS} />
            <Rows>
              {pending.map(({ approval }) => (
                <ApprovalRow key={approval.id} approval={approval} />
              ))}
            </Rows>
          </>
        )}
      </Card>

      {step >= 5 && (
        <Card
          icon="lock"
          title={copy.approvals.context.title}
          subtitle={copy.approvals.context.subtitle}
        >
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
              <Group variant="danger" icon="close" label="What was refused">
                <ul className="space-y-2">
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
              </Group>
            </div>
        </Card>
      )}

      {settled.length > 0 && (
        <Card
          icon="audit"
          title={copy.approvals.history.title}
          subtitle={copy.approvals.history.subtitle || undefined}
          flush
        >
          <Rows>
            {settled.map(({ approval, outcome }) => (
              // Still a link: a decision you have already taken is the thing you
              // most want to be able to go back and check.
              <li key={approval.id}>
                <Link
                  href={`/approvals/${approval.id}`}
                  className={cx("block", row.pad, row.hover)}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] text-ink">{approval.action}</span>
                    <Badge
                      variant={outcome === "approved" ? "seal" : "danger"}
                      icon={outcome === "approved" ? "checkCircle" : "close"}
                      className="ml-auto"
                    >
                      {outcome === "approved" ? "You approved this" : "You said no"}
                    </Badge>
                    <Icon name="chevronRight" size={15} className="shrink-0 text-ink-muted" />
                  </div>
                  <p className={cx("mt-1.5", type_.meta)}>
                    {`${approval.childAlias} · asked you on ${approval.createdAt} · shared ${approval.projection.disclosed.length} details, held back ${approval.projection.withheld.length}`}
                  </p>
                </Link>
              </li>
            ))}
          </Rows>
        </Card>
      )}

    </div>
  );
}

/**
 * The queue's column track, shared with its header so values line up. Below
 * `lg` there is no grid: a row stacks and each cell states its own field name.
 */
const COLUMNS =
  "lg:grid lg:grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_112px_minmax(0,1.35fr)_minmax(0,1.1fr)_116px_16px] lg:items-center lg:gap-x-4";

const QUEUE_LABELS = (copy: ReturnType<typeof useViewer>["copy"]) => {
  const { columns } = copy.approvals;
  return [
    columns.subject,
    columns.status,
    columns.shares,
    columns.recipient,
    columns.purpose,
    columns.raised,
  ];
};

/**
 * One held action, as a row.
 *
 * The decision is not taken from here. Approving sends a real message to another
 * organization on a child's behalf, so it needs the drafted wording and the
 * disclosed field set on screen first — which is a page, not a table cell.
 */
function ApprovalRow({ approval }: { approval: ApprovalRequest }) {
  const { copy } = useViewer();
  const elevated = approval.urgency === "elevated";

  return (
    <li>
      <Link
        href={`/approvals/${approval.id}`}
        className={cx(
          "block border-l-2",
          row.pad,
          COLUMNS,
          row.hover,
          elevated ? "border-l-accent" : "border-l-transparent",
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={approval.childAlias} size={36} variant={elevated ? "warn" : "accent"} />
          <div className="min-w-0">
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="truncate text-[13.5px] font-semibold text-ink">
                {approval.childAlias}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-ink-muted">
                {approval.caseId}
              </span>
            </div>
            <p className={cx("mt-0.5 truncate", type_.small)}>{approval.action}</p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5 lg:mt-0">
          <Badge variant="accent" icon="user">
            Needs you
          </Badge>
          {elevated && (
            <Badge variant="warn" icon="alert">
              Overdue
            </Badge>
          )}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-3 sm:grid-cols-4 lg:contents">
          <TableCell label={copy.approvals.columns.shares}>
            <span className="tabular-nums">
              <span className="text-brand-deep">{approval.projection.disclosed.length}</span>
              <span className="text-ink-muted"> / </span>
              <span className="text-danger">{approval.projection.withheld.length}</span>
            </span>
          </TableCell>
          <TableCell label={copy.approvals.columns.recipient}>{approval.recipient}</TableCell>
          <TableCell label={copy.approvals.columns.purpose}>
            {purposeLabel(approval.purpose)}
          </TableCell>
          <TableCell label={copy.approvals.columns.raised}>
            <span className="tabular-nums">{approval.createdAt}</span>
          </TableCell>
        </div>

        <Icon name="chevronRight" size={16} className="hidden shrink-0 text-ink-muted lg:block" />
      </Link>
    </li>
  );
}

