"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState, useSyncExternalStore } from "react";
import { Icon, type IconName } from "@/components/icons";
import {
  Avatar,
  Badge,
  Card,
  EmptyState,
  FlagBadge,
  Mono,
  Note,
  ProgressBar,
  cx,
} from "@/components/ui/primitives";
import { control, layout, surface, type as type_ } from "@/design/tokens";
import { useDemo } from "@/lib/demo-store";
import { PRIMARY_CASE_ID, WORKFLOW_ID } from "@/lib/mock/cases";
import { useViewer } from "@/lib/viewer";
import type { CaseFlag, CaseSummary } from "@/lib/types";

const FILTERS: { id: string; label: string; icon: IconName; flags: CaseFlag[] | null }[] = [
  { id: "all", label: "", icon: "cases", flags: null },
  { id: "attention", label: "Needs attention", icon: "alert", flags: ["overdue", "blocked"] },
  { id: "approval", label: "Waiting on a human", icon: "approvals", flags: ["approval_needed"] },
  { id: "monitoring", label: "On track", icon: "check", flags: ["on_track"] },
  { id: "intake", label: "Not yet activated", icon: "clock", flags: ["intake_pending"] },
  { id: "closed", label: "Completed", icon: "checkCircle", flags: ["recently_completed"] },
];

const SORTS = [
  { id: "urgency", label: "Most urgent first" },
  { id: "deadline", label: "Longest wait first" },
  { id: "alpha", label: "Name A–Z" },
] as const;

const VIEWS = [
  { id: "list", label: "List", icon: "list" as IconName },
  { id: "grid", label: "Grid", icon: "grid" as IconName },
] as const;

type ViewMode = (typeof VIEWS)[number]["id"];

/** Layout choice is a personal habit, so it outlives the visit. */
const VIEW_KEY = "caserelay.cases.view";

const viewListeners = new Set<() => void>();

function subscribeToView(listener: () => void) {
  viewListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    viewListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function useStoredView(): [ViewMode, (next: ViewMode) => void] {
  const view = useSyncExternalStore(
    subscribeToView,
    () => (window.localStorage.getItem(VIEW_KEY) === "grid" ? "grid" : "list"),
    () => "list" as ViewMode,
  );

  function chooseView(next: ViewMode) {
    window.localStorage.setItem(VIEW_KEY, next);
    for (const listener of viewListeners) listener();
  }

  return [view, chooseView];
}

function urgencyScore(item: CaseSummary) {
  let score = item.oldestGapDays;
  if (item.flags.includes("approval_needed")) score += 40;
  if (item.flags.includes("blocked")) score += 25;
  if (item.flags.includes("recently_completed")) score -= 50;
  return score;
}

export default function CasesPage() {
  // The header search hands its query over in ?q=, which needs a boundary here.
  return (
    <Suspense fallback={null}>
      <CasesRoute />
    </Suspense>
  );
}

function CasesRoute() {
  // Keyed on the handoff so a fresh search from the header starts a fresh list,
  // even when we are already standing on this page.
  const handoff = useSearchParams().get("q") ?? "";
  return <CasesView key={handoff} handoff={handoff} />;
}

function CasesView({ handoff }: { handoff: string }) {
  const { cases } = useDemo();
  const { copy, showsTechnical } = useViewer();
  const [query, setQuery] = useState(handoff);
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState<(typeof SORTS)[number]["id"]>("urgency");
  const [view, chooseView] = useStoredView();

  const rows = useMemo(() => {
    const active = FILTERS.find((item) => item.id === filter);
    const needle = query.trim().toLowerCase();

    const filtered = cases.filter((item) => {
      const matchesFilter =
        !active?.flags || item.flags.some((flag) => active.flags?.includes(flag));
      const matchesQuery =
        needle.length === 0 ||
        [item.id, item.childAlias, item.county, item.headline, item.courtOrder]
          .join(" ")
          .toLowerCase()
          .includes(needle);
      return matchesFilter && matchesQuery;
    });

    return [...filtered].sort((a, b) => {
      if (sort === "alpha") return a.childAlias.localeCompare(b.childAlias);
      if (sort === "deadline") return b.oldestGapDays - a.oldestGapDays;
      return urgencyScore(b) - urgencyScore(a);
    });
  }, [cases, filter, query, sort]);

  const counts = useMemo(
    () =>
      Object.fromEntries(
        FILTERS.map((item) => [
          item.id,
          item.flags
            ? cases.filter((entry) => entry.flags.some((flag) => item.flags?.includes(flag))).length
            : cases.length,
        ]),
      ),
    [cases],
  );

  return (
    <div className={layout.stack}>
      <section className={cx(surface.card, "px-4 py-4")}>
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative min-w-[220px] max-w-[520px] flex-1">
            <Icon
              name="search"
              size={15}
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-muted"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={copy.cases.searchPlaceholder}
              className={control.input}
            />
            <span className="sr-only">Search</span>
          </label>

          <label className="flex items-center gap-2">
            <Icon name="filter" size={15} className="text-ink-muted" />
            <span className="sr-only">Sort</span>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as typeof sort)}
              className="rounded-control border border-line bg-surface-soft px-3 py-2 text-[13px] text-ink-soft focus:border-brand/40 focus:outline-none"
            >
              {SORTS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div
            className="flex items-center gap-0.5 rounded-full border border-line bg-surface-soft p-0.5"
            role="group"
            aria-label="Result layout"
          >
            {VIEWS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => chooseView(option.id)}
                aria-pressed={view === option.id}
                title={`${option.label} view`}
                className={cx(
                  "flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12px] font-medium transition-colors",
                  view === option.id
                    ? "bg-surface text-brand-deep shadow-card"
                    : "text-ink-muted hover:text-ink-soft",
                )}
              >
                <Icon name={option.icon} size={14} />
                <span className="hidden sm:inline">{option.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setFilter(option.id)}
              className={filter === option.id ? control.chipActive : control.chip}
            >
              <Icon name={option.icon} size={14} />
              {option.id === "all" ? copy.cases.filterAll : option.label}
              <span className="font-mono text-[11px] opacity-60">{counts[option.id]}</span>
            </button>
          ))}
        </div>
      </section>

      <Card
        icon="cases"
        title={copy.cases.listing.title}
        subtitle={copy.cases.listing.subtitle}
        action={<span className={type_.meta}>{rows.length} shown</span>}
        bodyClassName="px-3 py-3"
      >
        {rows.length === 0 ? (
          <EmptyState icon="search" title={copy.cases.empty.title} hint={copy.cases.empty.hint} />
        ) : view === "grid" ? (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 3xl:grid-cols-4">
            {rows.map((item) => (
              <CaseCard key={item.id} item={item} technical={showsTechnical} copy={copy} />
            ))}
          </ul>
        ) : (
          <ul className="grid grid-cols-1 gap-2">
            {rows.map((item) => (
              <CaseRow key={item.id} item={item} technical={showsTechnical} copy={copy} />
            ))}
          </ul>
        )}
      </Card>

      <Note icon="lock">{copy.cases.footnote}</Note>
    </div>
  );
}

function CaseRow({
  item,
  technical,
  copy,
}: {
  item: CaseSummary;
  technical: boolean;
  copy: ReturnType<typeof useViewer>["copy"];
}) {
  const isPrimary = item.id === PRIMARY_CASE_ID;
  const closed = item.commitmentCount - item.openCommitments;
  const urgent = item.flags.some((flag) => flag === "overdue" || flag === "blocked");

  return (
    <li className="@container">
      <Link
        href={`/cases/${item.id}`}
        className={cx(
          "block rounded-control border px-4 py-3.5 transition-colors",
          isPrimary
            ? "border-brand/30 bg-brand-soft/60 hover:bg-brand-soft"
            : "border-line bg-surface-soft hover:bg-surface-muted",
        )}
      >
        <div className="flex flex-wrap items-center gap-3">
          <Avatar
            name={technical ? item.id.replace("CR-", "W ") : item.childAlias}
            size={40}
            variant={urgent ? "danger" : isPrimary ? "brand" : "neutral"}
          />

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[14px] font-semibold text-ink">
                {technical ? item.id : item.childAlias}
              </span>
              <span className="font-mono text-[11.5px] text-ink-muted">
                {technical ? item.childAlias : item.id}
              </span>
              {isPrimary && (
                <Badge variant="brand" icon="sparkle">
                  {technical ? "Scenario-bound" : "Walkthrough case"}
                </Badge>
              )}
            </div>
            <p className={cx("mt-1", type_.small)}>{item.headline}</p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {item.flags.map((flag) => (
              <FlagBadge key={flag} flag={flag} />
            ))}
          </div>

          <Icon name="chevronRight" size={17} className="shrink-0 text-ink-muted" />
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-x-6 gap-y-3 border-t border-line pt-3">
          <div className="grid min-w-0 flex-1 gap-3 @md:grid-cols-2 @3xl:grid-cols-4">
            <Meta icon="check" label={copy.cases.columns.commitments}>
              {closed} of {item.commitmentCount}
            </Meta>
            <Meta icon="calendar" label={copy.cases.columns.deadline}>
              {item.nextDeadline}
            </Meta>
            <Meta icon={technical ? "identity" : "legal"} label={copy.cases.columns.third}>
              {technical && isPrimary ? <Mono className="text-[11.5px]">{WORKFLOW_ID}</Mono> : item.courtOrder}
            </Meta>
            <Meta icon="user" label={copy.cases.columns.fourth}>
              {item.supervisor}
            </Meta>
          </div>

          <div className="w-full @md:w-[220px]">
            <ProgressBar
              value={closed}
              total={item.commitmentCount}
              variant={urgent ? "warn" : "seal"}
            />
          </div>
        </div>
      </Link>
    </li>
  );
}

/** Grid view: the same case, reshaped so a wall of them stays scannable. */
function CaseCard({
  item,
  technical,
  copy,
}: {
  item: CaseSummary;
  technical: boolean;
  copy: ReturnType<typeof useViewer>["copy"];
}) {
  const isPrimary = item.id === PRIMARY_CASE_ID;
  const closed = item.commitmentCount - item.openCommitments;
  const urgent = item.flags.some((flag) => flag === "overdue" || flag === "blocked");

  return (
    <li>
      <Link
        href={`/cases/${item.id}`}
        className={cx(
          "flex h-full flex-col rounded-control border px-4 py-3.5 transition-colors",
          isPrimary
            ? "border-brand/30 bg-brand-soft/60 hover:bg-brand-soft"
            : "border-line bg-surface-soft hover:bg-surface-muted",
        )}
      >
        <div className="flex items-start gap-3">
          <Avatar
            name={technical ? item.id.replace("CR-", "W ") : item.childAlias}
            size={38}
            variant={urgent ? "danger" : isPrimary ? "brand" : "neutral"}
          />
          <div className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-semibold text-ink">
              {technical ? item.id : item.childAlias}
            </span>
            <span className="mt-0.5 block truncate font-mono text-[11px] text-ink-muted">
              {technical ? item.childAlias : item.id}
            </span>
          </div>
          <Icon name="chevronRight" size={16} className="mt-1 shrink-0 text-ink-muted" />
        </div>

        <p className={cx("mt-2.5 line-clamp-2", type_.small)}>{item.headline}</p>

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {isPrimary && (
            <Badge variant="brand" icon="sparkle">
              {technical ? "Scenario-bound" : "Walkthrough case"}
            </Badge>
          )}
          {item.flags.map((flag) => (
            <FlagBadge key={flag} flag={flag} />
          ))}
        </div>

        <div className="mt-auto pt-3.5">
          <ProgressBar
            value={closed}
            total={item.commitmentCount}
            variant={urgent ? "warn" : "seal"}
          />
          <div className="mt-3 grid grid-cols-2 gap-3 border-t border-line pt-3">
            <Meta icon="check" label={copy.cases.columns.commitments}>
              {closed} of {item.commitmentCount}
            </Meta>
            <Meta icon="calendar" label={copy.cases.columns.deadline}>
              {item.nextDeadline}
            </Meta>
          </div>
        </div>
      </Link>
    </li>
  );
}

function Meta({
  icon,
  label,
  children,
}: {
  icon: IconName;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 text-[10.5px] font-medium tracking-[0.06em] text-ink-muted uppercase">
        <Icon name={icon} size={12} />
        {label}
      </p>
      <p className="mt-1 truncate text-[12.5px] text-ink-soft">{children}</p>
    </div>
  );
}
