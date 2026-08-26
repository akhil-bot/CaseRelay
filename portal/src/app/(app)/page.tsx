"use client";

import Link from "next/link";
import { Icon, type IconName } from "@/components/icons";
import { KIND_META } from "@/components/shell/ActivityPanel";
import {
  Avatar,
  Badge,
  Card,
  DomainIcon,
  EmptyState,
  FlagBadge,
  ProgressBar,
  Rows,
  StatusBadge,
  cx,
} from "@/components/ui/primitives";
import { control, layout, row, surface, tone, type as type_, type Tone } from "@/design/tokens";
import { useDemo } from "@/lib/demo-store";
import { PRIMARY_CASE_ID } from "@/lib/mock/cases";
import { useViewer } from "@/lib/viewer";

export default function OverviewPage() {
  const { cases, commitments, activity, pendingApprovals, meta, capabilities } = useDemo();
  const { copy } = useViewer();

  const attention = cases.filter((item) =>
    item.flags.some((flag) => flag === "overdue" || flag === "blocked"),
  );
  const unowned = commitments.filter((item) => (item.daysOverdue ?? 0) > 0);
  const openCommitments = commitments.filter((item) => item.status !== "completed");
  const closed = commitments.length - openCommitments.length;
  const recent = [...activity].reverse().slice(0, 5);

  const summaryText =
    pendingApprovals.length > 0
      ? `${pendingApprovals.length} message${pendingApprovals.length === 1 ? "" : "s"} need your approval, and ${unowned.length === 0 ? "no step is" : `${unowned.length} step${unowned.length === 1 ? " is" : "s are"}`} still waiting for someone to take responsibility.`
      : unowned.length > 0
        ? `${unowned.length} step${unowned.length === 1 ? "" : "s"} still have nobody responsible for them.`
        : "Every step on your cases has someone responsible for it.";

  return (
    <div className={layout.stack}>
      <section className={cx(surface.card, "px-5 py-5")}>
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <p className={cx(layout.measure, "text-[15px] leading-relaxed text-ink")}>
              {summaryText}
            </p>
          </div>
          <Link href="/cases" className={control.primary}>
            See my cases
            <Icon name="arrowRight" size={15} />
          </Link>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <Badge variant="brand" icon="clock">
            {meta.dayLabel}
          </Badge>
          <p className={cx("min-w-0 flex-1", layout.measure, type_.small)}>{meta.narration}</p>
        </div>
      </section>

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
          label={copy.overview.stats.waiting}
          value={pendingApprovals.length}
          note={copy.overview.statNotes.waiting}
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
            <Link href="/cases" className={control.secondary}>
              All cases
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
        icon="shield"
        title="What CaseRelay has proven"
        subtitle="Capabilities demonstrated at the current point in the scenario, with the evidence."
      >
        <ul className="grid gap-x-6 gap-y-5 sm:grid-cols-2 2xl:grid-cols-3">
          {capabilities.map((capability) => (
            <li key={capability.key} className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12.5px] font-medium text-ink">{capability.label}</span>
                <Badge
                  variant={capability.proven ? "seal" : "neutral"}
                  icon={capability.proven ? "checkCircle" : "clock"}
                  className="ml-auto"
                >
                  {capability.proven ? "Proven" : `Step ${capability.provenAtStep + 1}`}
                </Badge>
              </div>
              <p className={cx("mt-1.5", type_.meta)}>{capability.evidence}</p>
            </li>
          ))}
        </ul>
      </Card>

      <Card
        icon="cases"
        title={copy.overview.commitments.title}
        subtitle={copy.overview.commitments.subtitle}
        action={
          <Link href={`/cases/${PRIMARY_CASE_ID}`} className={control.secondary}>
            Open case
            <Icon name="arrowRight" size={14} />
          </Link>
        }
      >
        <div className="mb-4 flex flex-wrap items-center gap-4">
          <span className="min-w-[180px] max-w-[420px] flex-1">
            <ProgressBar value={closed} total={commitments.length} variant="seal" />
          </span>
          <span className={type_.meta}>
            {closed} of {commitments.length} done
          </span>
        </div>

        <ul className="grid gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4">
          {commitments.map((commitment) => (
            <li key={commitment.id} className="flex items-start gap-3">
              <DomainIcon domain={commitment.domain} size={32} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-medium text-ink">
                  {commitment.title}
                </span>
                <span className="mt-1 flex flex-wrap items-center gap-1.5">
                  <StatusBadge status={commitment.status} />
                  {(commitment.daysOverdue ?? 0) > 0 && (
                    <Badge variant="danger" icon="clock">
                      {commitment.daysOverdue} days waiting
                    </Badge>
                  )}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
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
