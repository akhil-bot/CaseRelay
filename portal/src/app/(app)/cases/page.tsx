"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Icon, type IconName } from "@/components/icons";
import {
  Avatar,
  Badge,
  Card,
  EmptyState,
  FlagBadge,
  Mono,
  ProgressBar,
  Rows,
  cx,
} from "@/components/ui/primitives";
import { control, layout, row, surface, type as type_ } from "@/design/tokens";
import { listCases } from "@/lib/api";
import { useDemo } from "@/lib/demo-store";
import { PRIMARY_CASE_ID, WORKFLOW_ID } from "@/lib/mock/cases";
import { useViewer } from "@/lib/viewer";
import type { CaseFlag, CaseSummary } from "@/lib/types";

type Filter = { id: string; label: string; icon: IconName; flags: CaseFlag[] | null };

const FILTERS: Filter[] = [
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
  const handoff = useSearchParams().get("q") ?? "";
  return (
    <div className={layout.stack}>
      <LiveCasesSection />
      <CasesView key={handoff} handoff={handoff} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live cases from the control plane — shown above the mock caseload
// ---------------------------------------------------------------------------

function LiveCasesSection() {
  const [liveCases, setLiveCases] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listCases()
      .then((cases) => {
        setLiveCases(cases);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, []);

  if (loading || (liveCases.length === 0 && !error)) return null;

  if (error) {
    return (
      <Card icon="activity" title="Live Cases">
        <div className="flex items-start gap-3 rounded-control border border-danger/25 bg-danger/5 px-4 py-3">
          <Icon name="alert" size={18} className="mt-0.5 shrink-0 text-danger" />
          <p className={type_.small}>{error}</p>
        </div>
      </Card>
    );
  }

  return (
    <Card
      icon="activity"
      title="Live Cases"
      subtitle={`${liveCases.length} case${liveCases.length === 1 ? "" : "s"} on the control plane`}
      flush
    >
      <Rows>
        {liveCases.map((c) => {
          const id = String(c.case_id ?? "");
          const name = String(c.child_name ?? id);
          const status = String(c.status ?? "unknown");
          return (
            <li key={id}>
              <Link
                href={`/cases/${id}`}
                className={cx(
                  "flex items-center gap-3 border-l-2 border-l-accent",
                  row.pad,
                  row.hover,
                )}
              >
                <Avatar name={name} size={36} variant="brand" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-[13.5px] font-semibold text-ink">{name}</span>
                    <span className="shrink-0 font-mono text-[11px] text-ink-muted">{id}</span>
                  </div>
                  <p className={cx("mt-0.5 truncate", type_.small)}>
                    {String(c.scenario ?? (c.referral_packet as Record<string, unknown> | undefined)?.scenario ?? "")} — {status}
                  </p>
                </div>
                <Badge variant="accent" icon="activity">Live</Badge>
                <Icon name="chevronRight" size={16} className="shrink-0 text-ink-muted" />
              </Link>
            </li>
          );
        })}
      </Rows>
    </Card>
  );
}

function CasesView({ handoff }: { handoff: string }) {
  const { cases } = useDemo();
  const { copy, showsTechnical } = useViewer();
  const [query, setQuery] = useState(handoff);
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState<(typeof SORTS)[number]["id"]>("urgency");
  const [view, chooseView] = useStoredView();

  const searched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return cases;
    return cases.filter((item) =>
      [item.id, item.childAlias, item.county, item.headline, item.courtOrder]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [cases, query]);

  const rows = useMemo(() => {
    const active = FILTERS.find((item) => item.id === filter);
    const filtered = active?.flags
      ? searched.filter((item) => item.flags.some((flag) => active.flags?.includes(flag)))
      : searched;

    return [...filtered].sort((a, b) => {
      if (sort === "alpha") return a.childAlias.localeCompare(b.childAlias);
      if (sort === "deadline") return b.oldestGapDays - a.oldestGapDays;
      return urgencyScore(b) - urgencyScore(a);
    });
  }, [searched, filter, sort]);

  /**
   * Counts follow the search rather than the whole caseload, so each entry in the
   * menu answers the question you actually have while typing — how many of these
   * results are overdue — and the count on the closed menu is what you can see.
   */
  const counts = useMemo(
    () =>
      Object.fromEntries(
        FILTERS.map((item) => [
          item.id,
          item.flags
            ? searched.filter((entry) => entry.flags.some((flag) => item.flags?.includes(flag)))
                .length
            : searched.length,
        ]),
      ),
    [searched],
  );

  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      <label className="relative w-[200px] 2xl:w-[260px]">
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

      <FilterMenu
        value={filter}
        counts={counts}
        allLabel={copy.cases.filterAll}
        onChange={setFilter}
      />

      {/* Stripped of its native chrome so it reads as the same kind of control as
          the filter beside it, which a menu of icons and counts cannot be. */}
      <label className={cx(control.select, "relative pr-8 focus-within:border-brand/40")}>
        <Icon name="filter" size={15} />
        <span className="sr-only">Sort</span>
        <select
          value={sort}
          onChange={(event) => setSort(event.target.value as typeof sort)}
          className="appearance-none bg-transparent focus:outline-none"
        >
          {SORTS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <Icon
          name="chevronDown"
          size={15}
          className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 opacity-70"
        />
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
            {/* The words are the first thing to go: two shapes this familiar can
                hold the choice on their own until the header has room again. */}
            <span className="hidden 2xl:inline">{option.label}</span>
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <Card
      icon="cases"
      title={copy.cases.listing.title}
      subtitle={copy.cases.listing.subtitle}
      action={controls}
      flush={rows.length > 0 && view === "list"}
      // The caseload is the page, so it takes the window: search, filters and the
      // column names stay put at the top, the rows scroll under them, and six
      // cases no longer leave half a screen of nothing underneath.
      fill
      className={layout.fillHeight}
      // Nothing found: the notice sits in the middle of the space rather than at
      // the top of it, and still spans the card's width.
      bodyClassName={rows.length === 0 ? "flex flex-col justify-center" : undefined}
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
        <>
          <ColumnHeader copy={copy} />
          <Rows>
            {rows.map((item) => (
              <CaseRow key={item.id} item={item} technical={showsTechnical} copy={copy} />
            ))}
          </Rows>
        </>
      )}
    </Card>
  );
}

/**
 * The list view's column track, shared by the header row and every case row so
 * the values line up down the page instead of each row restating its own field
 * names.
 *
 * Below `lg` there is no grid: seven columns will not fit, so a row falls back
 * to stacking and every cell labels itself again.
 */
const COLUMNS =
  "lg:grid lg:grid-cols-[minmax(0,2.5fr)_minmax(0,1.15fr)_132px_minmax(0,0.85fr)_minmax(0,1fr)_minmax(0,1fr)_16px] lg:items-center lg:gap-x-4";

/** The field names, stated once above the list rather than inside every row. */
function ColumnHeader({ copy }: { copy: ReturnType<typeof useViewer>["copy"] }) {
  const { columns } = copy.cases;
  return (
    <div
      className={cx(
        // A tint rather than a hairline alone: this is chrome, not a row, and the
        // fill is what stops it reading as the first case in the list. Opaque, so
        // it can hold the top of the scroller with rows passing beneath it.
        "hidden border-b border-line bg-surface-soft px-5 py-2.5",
        "sticky top-0 z-10",
        // Matches the state rule every row carries, so the two column tracks
        // start at the same x and the headings sit true over their values.
        "border-l-2 border-l-transparent",
        COLUMNS,
      )}
      aria-hidden="true"
    >
      {[columns.case, columns.status, columns.commitments, columns.deadline, columns.third, columns.fourth].map(
        (label) => (
          <span key={label} className={cx("truncate", type_.label)}>
            {label}
          </span>
        ),
      )}
      <span />
    </div>
  );
}

/**
 * Six named slices of the caseload, one at a time. As chips they were a second
 * row of controls wide enough to push the list itself below the fold, and the
 * five you were not using outnumbered the one you were.
 */
function FilterMenu({
  value,
  counts,
  allLabel,
  onChange,
}: {
  value: string;
  counts: Record<string, number>;
  allLabel: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const label = (option: Filter) => (option.id === "all" ? allLabel : option.label);
  const active = FILTERS.find((option) => option.id === value) ?? FILTERS[0];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={value === "all" ? control.select : control.selectActive}
      >
        <Icon name={active.icon} size={15} />
        {label(active)}
        <span className="font-mono text-[11px] opacity-60">{counts[active.id]}</span>
        <Icon name="chevronDown" size={15} className="opacity-70" />
      </button>

      {open && (
        <div
          role="menu"
          className={cx(
            surface.pop,
            "animate-rise absolute top-full left-0 z-30 mt-1.5 w-[252px] p-1.5",
          )}
        >
          {FILTERS.map((option) => {
            const selected = option.id === value;
            return (
              <button
                key={option.id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => {
                  onChange(option.id);
                  setOpen(false);
                }}
                className={selected ? control.menuItemActive : control.menuItem}
              >
                <Icon name={option.icon} size={15} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">{label(option)}</span>
                <span className="font-mono text-[11px] opacity-60">{counts[option.id]}</span>
                {selected && <Icon name="check" size={14} className="shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
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
    <li>
      <Link
        href={`/cases/${item.id}`}
        className={cx(
          "block border-l-2",
          row.pad,
          COLUMNS,
          // State reads off the leading edge, the way it does on a commitment or
          // an approval, so it costs no column width.
          urgent ? "border-l-danger" : isPrimary ? "border-l-brand" : "border-l-transparent",
          isPrimary ? row.selected : row.hover,
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          <Avatar
            name={technical ? item.id.replace("CR-", "W ") : item.childAlias}
            size={36}
            variant={urgent ? "danger" : isPrimary ? "brand" : "neutral"}
          />
          <div className="min-w-0">
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="truncate text-[13.5px] font-semibold text-ink">
                {technical ? item.id : item.childAlias}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-ink-muted">
                {technical ? item.childAlias : item.id}
              </span>
            </div>
            <p className={cx("mt-0.5 truncate", type_.small)}>{item.headline}</p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5 lg:mt-0">
          {isPrimary && (
            <Badge variant="brand" icon="sparkle">
              {technical ? "Scenario-bound" : "Walkthrough"}
            </Badge>
          )}
          {item.flags.map((flag) => (
            <FlagBadge key={flag} flag={flag} />
          ))}
        </div>

        {/* `lg:contents` dissolves this wrapper into the row's own grid, so the
            four cells become columns there and a stacked block below it. */}
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-3 sm:grid-cols-4 lg:contents">
          <Cell label={copy.cases.columns.commitments}>
            <span className="tabular-nums">
              {closed} of {item.commitmentCount}
            </span>
            <ProgressBar
              value={closed}
              total={item.commitmentCount}
              variant={urgent ? "warn" : "seal"}
              hideValue
              className="mt-1.5"
            />
          </Cell>
          <Cell label={copy.cases.columns.deadline}>
            <span className="tabular-nums">{item.nextDeadline}</span>
          </Cell>
          <Cell label={copy.cases.columns.third}>
            {technical && isPrimary ? (
              <Mono className="text-[11.5px]">{WORKFLOW_ID}</Mono>
            ) : (
              item.courtOrder
            )}
          </Cell>
          <Cell label={copy.cases.columns.fourth}>{item.supervisor}</Cell>
        </div>

        <Icon
          name="chevronRight"
          size={16}
          className="hidden shrink-0 text-ink-muted lg:block"
        />
      </Link>
    </li>
  );
}

/**
 * One value in the table. The label is the column header's job at `lg`; below
 * that there is no header, so the cell carries it.
 */
function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className={cx("lg:hidden", type_.label)}>{label}</p>
      <div className="mt-1 min-w-0 truncate text-[12.5px] text-ink-soft lg:mt-0">{children}</div>
    </div>
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
          // Grid view cannot use dividers, so a card keeps its outline here — but
          // only the outline. A fill on top of it is the second surface that made
          // these read as boxes inside a box.
          isPrimary
            ? "border-brand/30 bg-brand-soft/50 hover:bg-brand-soft"
            : "border-line hover:bg-surface-soft",
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
