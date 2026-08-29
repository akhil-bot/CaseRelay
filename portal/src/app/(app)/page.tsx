"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon, type IconName } from "@/components/icons";
import { KIND_META } from "@/lib/activity-meta";
import {
  Avatar,
  Badge,
  Card,
  DomainIcon,
  EmptyState,
  FlagBadge,
  Mono,
  ProgressBar,
  Rows,
  StatusBadge,
  cx,
} from "@/components/ui/primitives";
import { control, layout, row, surface, tone, type as type_, type Tone } from "@/design/tokens";
import { useDemo } from "@/lib/demo-store";
import { useLiveApprovals } from "@/lib/live-approvals";
import { PRIMARY_CASE_ID } from "@/lib/mock/cases";
import type { CaseSummary, Commitment } from "@/lib/types";
import { useViewer } from "@/lib/viewer";

export default function OverviewPage() {
  const { cases, commitments, activity } = useDemo();
  const { gates } = useLiveApprovals();
  const { copy, role } = useViewer();

  // The gates are the supervisor's to clear. For anyone else the same number is
  // still worth knowing — those cases are stopped — but "waiting on you" would
  // be asking them for something they cannot give.
  const waitingOnMe = role === "supervisor";

  const attention = cases.filter((item) =>
    item.flags.some((flag) => flag === "overdue" || flag === "blocked"),
  );
  const unowned = commitments.filter((item) => (item.daysOverdue ?? 0) > 0);
  const openCommitments = commitments.filter((item) => item.status !== "completed");
  const recent = [...activity].reverse().slice(0, 5);

  return (
    // A flex column with a floor of the whole window, so the caseload at the
    // foot of the page can take whatever is left rather than stopping where its
    // rows happen to stop and leaving the screen half empty.
    <div className={cx("flex flex-col gap-5", layout.fillHeightMin)}>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          icon="alert"
          variant="danger"
          label={copy.overview.stats.owner}
          value={unowned.length}
          note={copy.overview.statNotes.owner}
        />
        <Stat
          icon="approvals"
          variant="accent"
          label={waitingOnMe ? copy.overview.stats.waiting : "Waiting on your supervisor"}
          value={gates.length}
          note={
            waitingOnMe
              ? copy.overview.statNotes.waiting
              : "Cases stopped until your supervisor decides"
          }
        />
        <Stat
          icon="cases"
          variant="brand"
          label={copy.overview.stats.open}
          value={openCommitments.length}
          note={copy.overview.statNotes.open}
        />
        <Stat
          icon="activity"
          variant="seal"
          label={copy.overview.stats.steps}
          value={activity.length}
          note={copy.overview.statNotes.steps}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <Card
          icon="alert"
          title={copy.overview.attention.title}
          subtitle={copy.overview.attention.subtitle}
          action={
            <Link href="/cases" className={control.primary}>
              See my cases
              <Icon name="arrowRight" size={15} />
            </Link>
          }
          flush={attention.length > 0}
        >
          {attention.length === 0 ? (
            <EmptyState
              icon="checkCircle"
              title={copy.overview.attentionEmpty.title}
              hint={copy.overview.attentionEmpty.hint}
            />
          ) : (
            <Rows>
              {attention.map((item) => (
                <li key={item.id}>
                  <Link
                    href={`/cases/${item.id}`}
                    className={cx("flex items-start gap-3", row.pad, row.hover)}
                  >
                    <Avatar name={item.childAlias} size={34} variant="danger" />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-[13.5px] font-medium text-ink">
                          {item.childAlias}
                        </span>
                        <span className="font-mono text-[11px] text-ink-muted">{item.id}</span>
                        {item.flags.map((flag) => (
                          <FlagBadge key={flag} flag={flag} />
                        ))}
                      </span>
                      <span className={cx("mt-1 block", type_.small)}>{item.headline}</span>
                    </span>
                    <Icon name="chevronRight" size={16} className="mt-2 shrink-0 text-ink-muted" />
                  </Link>
                </li>
              ))}
            </Rows>
          )}
        </Card>

        <Card
          icon="activity"
          title={copy.overview.activity.title}
          subtitle={copy.overview.activity.subtitle}
          flush
        >
          <Rows as="ol">
            {recent.map((event) => {
              const kind = KIND_META[event.kind];
              return (
                <li key={event.id} className={cx("flex gap-3", row.pad)}>
                  <span
                    className={cx(
                      "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border",
                      tone[kind.variant].badge,
                    )}
                  >
                    <Icon name={kind.icon} size={14} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[12.5px] leading-snug font-medium text-ink">
                      {event.summary}
                    </span>
                    <span className="mt-0.5 block font-mono text-[10.5px] text-ink-muted">
                      {event.at}
                    </span>
                  </span>
                </li>
              );
            })}
          </Rows>
        </Card>
      </div>

      <Card
        icon="cases"
        title={copy.overview.commitments.title}
        subtitle={copy.overview.commitments.subtitle}
        action={
          <Link href="/cases" className={control.secondary}>
            All cases
            <Icon name="arrowRight" size={14} />
          </Link>
        }
        flush
        // Takes the rest of the window: the header and column names hold still
        // and the rows scroll under them.
        fill
        className="flex-1"
      >
        <table className="w-full border-collapse text-left">
          <thead>
            {/* Sticky on the cells rather than the row — a sticky <tr> is not
                honoured everywhere, and the tint is what keeps rows from
                showing through as they pass beneath. */}
            <tr className="border-b border-line">
              <th
                scope="col"
                className={cx("sticky top-0 z-10 bg-surface-soft px-5 py-2.5", type_.label)}
              >
                {copy.cases.columns.case}
              </th>
              <th
                scope="col"
                className={cx(
                  "sticky top-0 z-10 hidden bg-surface-soft px-3 py-2.5 sm:table-cell",
                  type_.label,
                )}
              >
                {copy.cases.columns.status}
              </th>
              <th
                scope="col"
                className={cx(
                  "sticky top-0 z-10 hidden bg-surface-soft px-3 py-2.5 md:table-cell",
                  type_.label,
                )}
              >
                {copy.cases.columns.deadline}
              </th>
              <th
                scope="col"
                className={cx(
                  "sticky top-0 z-10 bg-surface-soft px-5 py-2.5 text-right",
                  type_.label,
                )}
              >
                {copy.cases.columns.commitments}
              </th>
            </tr>
          </thead>
          <tbody className={row.divide}>
            {cases.map((item) => (
              <CaseRow
                key={item.id}
                item={item}
                steps={item.id === PRIMARY_CASE_ID ? commitments : []}
              />
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

/**
 * A case, as a row that opens onto its progress and its steps. The row itself
 * is the control rather than a button inside the first cell, so the whole width
 * responds and the columns still line up against their headers.
 *
 * Only the flagship case carries step-level mock data, so `steps` is empty for
 * the rest and the panel says where that detail lives instead of rendering an
 * empty table.
 */
function CaseRow({ item, steps }: { item: CaseSummary; steps: Commitment[] }) {
  const [open, setOpen] = useState(false);
  const done = item.commitmentCount - item.openCommitments;

  return (
    <>
      <tr
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen((value) => !value);
          }
        }}
        className={cx("cursor-pointer", row.hover)}
      >
        <td className="px-5 py-3">
          <span className="flex items-center gap-2.5">
            <Icon
              name={open ? "chevronDown" : "chevronRight"}
              size={14}
              className="shrink-0 text-ink-muted"
            />
            <Avatar name={item.childAlias} size={30} />
            <span className="min-w-0">
              <span className="block truncate text-[12.5px] font-medium text-ink">
                {item.childAlias}
              </span>
              <Mono className="text-[11px]">{item.id}</Mono>
            </span>
          </span>
        </td>
        <td className="hidden px-3 py-3 sm:table-cell">
          <span className="flex flex-wrap items-center gap-1.5">
            {item.flags.map((flag) => (
              <FlagBadge key={flag} flag={flag} />
            ))}
          </span>
        </td>
        <td className={cx("hidden px-3 py-3 md:table-cell", type_.small)}>{item.nextDeadline}</td>
        <td className={cx("px-5 py-3 text-right whitespace-nowrap", type_.meta)}>
          {done} of {item.commitmentCount}
        </td>
      </tr>

      {open && (
        <tr>
          <td colSpan={4} className="p-0">
            <div className="animate-rise border-t border-line bg-surface-soft px-5 py-3.5">
              <p className={type_.small}>{item.headline}</p>

              <div className="mt-3 flex flex-wrap items-center gap-3">
                <span className="min-w-[160px] max-w-[320px] flex-1">
                  <ProgressBar value={done} total={item.commitmentCount} variant="seal" />
                </span>
                <span className={type_.meta}>
                  {done} of {item.commitmentCount} done
                </span>
              </div>

              <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-ink-muted">
                <span className="flex items-center gap-1.5">
                  <Icon name="user" size={13} />
                  {item.volunteer}
                </span>
                <span className="flex items-center gap-1.5">
                  <Icon name="users" size={13} />
                  {item.supervisor}
                </span>
                <span className="flex items-center gap-1.5">
                  <Icon name="clock" size={13} />
                  {item.nextDeadline}
                </span>
                <span className="flex items-center gap-1.5">
                  <Icon name="document" size={13} />
                  <Mono className="text-[11px]">{item.courtOrder}</Mono>
                </span>
              </div>

              {steps.length > 0 ? (
                <div className="mt-3 overflow-hidden rounded-control border border-line bg-surface">
                  <table className="w-full border-collapse text-left">
                    <tbody className={row.divide}>
                      {steps.map((commitment) => (
                        <CommitmentRow key={commitment.id} commitment={commitment} />
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className={cx("mt-3", type_.meta)}>
                  Step-by-step detail for this case opens on the case screen.
                </p>
              )}

              <Link
                href={`/cases/${item.id}`}
                className={cx(control.secondary, "mt-3")}
                onClick={(event) => event.stopPropagation()}
              >
                Open case
                <Icon name="arrowRight" size={14} />
              </Link>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * One step within a case, as a row that opens onto its evidence and owner.
 */
function CommitmentRow({ commitment }: { commitment: Commitment }) {
  const [open, setOpen] = useState(false);
  const waiting = commitment.daysOverdue ?? 0;

  return (
    <>
      <tr
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen((value) => !value);
          }
        }}
        className={cx("cursor-pointer", row.hover)}
      >
        <td className="px-5 py-3">
          <span className="flex items-center gap-2.5">
            <Icon
              name={open ? "chevronDown" : "chevronRight"}
              size={14}
              className="shrink-0 text-ink-muted"
            />
            <DomainIcon domain={commitment.domain} size={28} />
            <span className="min-w-0 text-[12.5px] font-medium text-ink">{commitment.title}</span>
          </span>
        </td>
        <td className={cx("hidden px-3 py-3 sm:table-cell", type_.small)}>{commitment.ownerOrg}</td>
        <td className="px-5 py-3 text-right">
          <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
            <StatusBadge status={commitment.status} />
            {waiting > 0 && (
              <Badge variant="danger" icon="clock">
                {waiting} days waiting
              </Badge>
            )}
          </span>
        </td>
      </tr>

      {open && (
        <tr>
          <td colSpan={3} className="p-0">
            <div className="animate-rise border-t border-line bg-surface-soft px-5 py-3.5">
              <p className={type_.small}>{commitment.detail}</p>
              <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11.5px] text-ink-muted">
                <span className="flex items-center gap-1.5 sm:hidden">
                  <Icon name="cases" size={13} />
                  {commitment.ownerOrg}
                </span>
                <span className="flex items-center gap-1.5">
                  <Icon name="identity" size={13} />
                  <Mono className="text-[11px]">{commitment.ownerAgentId}</Mono>
                </span>
                <span className="flex items-center gap-1.5">
                  <Icon name="clock" size={13} />
                  Due day {commitment.dueDay}
                </span>
                <span className="flex items-center gap-1.5">
                  <Icon name="activity" size={13} />
                  {commitment.lastUpdate}
                </span>
              </div>
              {commitment.evidence.length > 0 && (
                <ul className="mt-2.5 flex flex-wrap gap-1.5">
                  {commitment.evidence.map((ref) => (
                    <li key={ref.id}>
                      <span className="inline-flex items-center gap-1.5 rounded-control border border-line bg-surface px-2 py-1 text-[11px] text-ink-soft">
                        <Icon name="document" size={12} className="text-ink-muted" />
                        {ref.label}
                        <Mono className="text-[10.5px]">{ref.id}</Mono>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Stat({
  icon,
  variant,
  label,
  value,
  note,
}: {
  icon: IconName;
  variant: Tone;
  label: string;
  value: number;
  note: string;
}) {
  return (
    <div className={cx(surface.card, "px-4 py-4")}>
      <div className="flex items-center justify-between gap-2">
        <span className={type_.label}>{label}</span>
        <span
          className={cx(
            "flex size-8 items-center justify-center rounded-full border",
            tone[variant].badge,
          )}
        >
          <Icon name={icon} size={16} />
        </span>
      </div>
      <p className={cx("mt-3", type_.metric)}>{value}</p>
      <p className={cx("mt-1.5", type_.meta)}>{note}</p>
    </div>
  );
}
