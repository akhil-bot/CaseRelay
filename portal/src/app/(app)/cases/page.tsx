"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import { Avatar, Badge, Card, Dot, EmptyState, Loading, Rows, cx } from "@/components/ui/primitives";
import { control, layout, row, surface, type Tone, type as type_ } from "@/design/tokens";
import { CASE_PAGE, listCases } from "@/lib/api";
import { useViewer } from "@/lib/viewer";

/**
 * A case as this list needs it.
 *
 * /v1/cases answers with an open record, and the two code paths behind it do not
 * agree on the keys: the in-memory one carries four fields, the stored one the
 * whole case document. So every field is read defensively and normalised once
 * here, and the rest of the page sorts and filters against values it knows the
 * shape of.
 */
interface CaseRecord {
  id: string;
  /** Empty until intake names the child. The row says so rather than showing a dash. */
  name: string;
  status: string;
  /** Whose case it is. Empty on a case whose packet never named an advocate. */
  advocateId: string;
  advocateName: string;
  openedAt: number | null;
  /** The soonest referral deadline still ahead. Null once every one of them has passed. */
  nextDue: number | null;
  everyDatePassed: boolean;
  /** Everything the search box matches against, lowercased once at parse time. */
  haystack: string;
}

/** Sorts last, and never subtracts to NaN the way two Infinities would. */
const LAST = Number.MAX_SAFE_INTEGER;

/** A stable identity for "no cases yet", so the memos below do not rerun on every render. */
const EMPTY: CaseRecord[] = [];

const DAY = 86_400_000;

/** How many rows "show more" adds. Nothing to do with how many are fetched at a time. */
const PAGE = 40;

/** How many pages of the caseload are in the air at once while it loads. */
const BATCH = 6;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function fields(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function instant(value: unknown): number | null {
  const parsed = Date.parse(text(value));
  return Number.isNaN(parsed) ? null : parsed;
}

function toRecord(raw: Record<string, unknown>, now: number): CaseRecord {
  const packet = fields(raw.referral_packet);
  const id = text(raw.case_id) || text(packet.case_id);
  const name = text(raw.child_name) || text(fields(packet.child).name);
  const status = text(raw.status) || "unknown";
  const advocateId = text(raw.volunteer_id) || text(packet.volunteer_id);
  const advocateName = text(raw.volunteer_name) || text(packet.volunteer_name);

  const deadlines = (Array.isArray(packet.referrals) ? packet.referrals : [])
    .map((entry) => instant(fields(entry).due_date))
    .filter((value): value is number => value !== null);
  const ahead = deadlines.filter((value) => value >= now);

  return {
    id,
    name,
    status,
    advocateId,
    advocateName,
    openedAt: instant(raw.created_at),
    nextDue: ahead.length > 0 ? Math.min(...ahead) : null,
    everyDatePassed: deadlines.length > 0 && ahead.length === 0,
    haystack: [id, name, status, advocateName, text(packet.scenario)]
      .join(" ")
      .toLowerCase(),
  };
}

/**
 * The advocate a case is grouped under.
 *
 * Keyed on the id where there is one, because two advocates could share a name;
 * but the name is what the group is labelled with, so a case that carries a name
 * and no id still lands in the right place.
 */
function advocateKey(item: CaseRecord): string {
  return item.advocateId || item.advocateName || "";
}

const UNASSIGNED = "No advocate assigned";

function advocateLabel(item: CaseRecord): string {
  return item.advocateName || (item.advocateId ? item.advocateId : UNASSIGNED);
}

interface AdvocateGroup {
  key: string;
  label: string;
  items: CaseRecord[];
}

/**
 * Consecutive runs of one advocate's cases.
 *
 * A run rather than a bucket: the list is already ordered by advocate, so this
 * only has to notice where one ends. That means a group can never contain a case
 * the sort placed elsewhere, and paging can stay a slice of one flat list.
 */
function groupByAdvocate(items: CaseRecord[]): AdvocateGroup[] {
  const groups: AdvocateGroup[] = [];
  for (const item of items) {
    const key = advocateKey(item);
    const open = groups.at(-1);
    if (open && open.key === key) open.items.push(item);
    else groups.push({ key, label: advocateLabel(item), items: [item] });
  }
  return groups;
}

/**
 * The four states a case can hold, from the control plane's own transition table.
 *
 * `quiet` is the difference between a badge and a dot: a case that is simply
 * running is the norm across a caseload, and a badge every row carries is a
 * badge that says nothing. Only the states that are not "running normally" —
 * one waiting on a supervisor, one already finished — are worth the ink.
 */
const STATUS_META: Record<string, { label: string; variant: Tone; icon: IconName; quiet?: boolean }> =
  {
    draft: { label: "Awaiting activation", variant: "warn", icon: "clock" },
    active: { label: "Starting up", variant: "brand", icon: "activity", quiet: true },
    monitoring: { label: "CaseRelay is watching", variant: "brand", icon: "activity", quiet: true },
    closed: { label: "Completed", variant: "seal", icon: "checkCircle" },
  };

function statusMeta(status: string) {
  return (
    STATUS_META[status] ?? {
      label: status.replace(/_/g, " "),
      variant: "neutral" as Tone,
      icon: "activity" as IconName,
      quiet: true,
    }
  );
}

interface CaseFilter {
  id: string;
  label: string;
  icon: IconName;
  match: (item: CaseRecord) => boolean;
}

const FILTERS: CaseFilter[] = [
  { id: "all", label: "", icon: "cases", match: () => true },
  {
    id: "draft",
    label: "Awaiting activation",
    icon: "clock",
    match: (item) => item.status === "draft",
  },
  {
    id: "watching",
    label: "CaseRelay is watching",
    icon: "activity",
    match: (item) => item.status === "active" || item.status === "monitoring",
  },
  {
    id: "passed",
    label: "Every date has passed",
    icon: "alert",
    match: (item) => item.everyDatePassed && item.status !== "closed",
  },
  {
    id: "closed",
    label: "Completed",
    icon: "checkCircle",
    match: (item) => item.status === "closed",
  },
];

const SORTS = [
  { id: "urgency", label: "Most urgent first" },
  { id: "waiting", label: "Longest waiting first" },
  { id: "recent", label: "Newest first" },
  { id: "alpha", label: "Name A–Z" },
] as const;

type SortId = (typeof SORTS)[number]["id"];

function compare(sort: SortId, a: CaseRecord, b: CaseRecord) {
  if (sort === "alpha") {
    // An unnamed referral has nothing to alphabetise, so it goes to the end
    // rather than sorting as an empty string at the top.
    if (!a.name || !b.name) return Number(!a.name) - Number(!b.name) || a.id.localeCompare(b.id);
    return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  }
  if (sort === "waiting") return (a.openedAt ?? LAST) - (b.openedAt ?? LAST);
  if (sort === "recent") return (b.openedAt ?? 0) - (a.openedAt ?? 0);
  if (a.everyDatePassed !== b.everyDatePassed) return Number(b.everyDatePassed) - Number(a.everyDatePassed);
  return (a.nextDue ?? LAST) - (b.nextDue ?? LAST) || (a.openedAt ?? LAST) - (b.openedAt ?? LAST);
}

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

function openedLabel(at: number | null, now: number) {
  if (at === null) return "—";
  const days = Math.floor((now - at) / DAY);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

function dueLabel(at: number, now: number) {
  const days = Math.ceil((at - now) / DAY);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
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
  return <CaseList key={handoff} handoff={handoff} />;
}

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  // `now` is fixed at the moment the answer landed, so every relative date on
  // the page is measured from the same instant and a re-render cannot shift one
  // row's "3 days ago" out from under the row beside it.
  | { state: "loaded"; cases: CaseRecord[]; now: number };

function CaseList({ handoff }: { handoff: string }) {
  const { copy, role, profile } = useViewer();
  // A supervisor does not read a caseload as a list of children; they read it as
  // a list of the people they are responsible for. Nobody else has a team, so
  // nobody else gets the grouping.
  const grouped = role === "supervisor";
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [query, setQuery] = useState(handoff);
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState<SortId>("urgency");
  const [visible, setVisible] = useState(PAGE);

  /**
   * The caseload arrives a page at a time, and every page that lands is drawn.
   *
   * It is read to the end rather than stopping at the first page, because the
   * sorting and searching below happen here: the control plane cannot order a
   * caseload by urgency, and a "show 40 more" that only ever paged through the
   * hundred most recent cases would quietly answer the wrong question. What
   * paging buys is that the first rows appear after one short request instead
   * of one long one, and that a store nobody has pruned cannot hand the browser
   * everything in a single response.
   */
  useEffect(() => {
    let live = true;

    void (async () => {
      // Fixed before the first request rather than per page, so that every
      // relative date on the list is measured from one instant and a later
      // page cannot shift an earlier row's "3 days ago".
      const now = Date.now();
      const collected: CaseRecord[] = [];

      try {
        const first = await listCases({ limit: CASE_PAGE });
        if (!live) return;

        for (const item of first.items) collected.push(toRecord(item, now));
        setLoad({ state: "loaded", cases: [...collected], now });
        if (first.items.length === 0) return;

        // The first page says how many there are, so the rest are asked for
        // together rather than one behind another. In batches, because a long
        // caseload should not open fifty sockets at once, and because each
        // batch that lands is drawn rather than held back for the last one.
        const offsets: number[] = [];
        for (let at = first.items.length; at < first.total; at += CASE_PAGE) offsets.push(at);

        for (let i = 0; i < offsets.length; i += BATCH) {
          const batch = await Promise.all(
            offsets.slice(i, i + BATCH).map((offset) => listCases({ offset, limit: CASE_PAGE })),
          );
          if (!live) return;

          for (const page of batch) {
            for (const item of page.items) collected.push(toRecord(item, now));
          }
          setLoad({ state: "loaded", cases: [...collected], now });
        }
      } catch (err: unknown) {
        if (!live) return;
        // A page that fails after others have landed leaves what did arrive on
        // screen. Only a first page that never came is nothing to show.
        if (collected.length > 0) return;
        setLoad({ state: "error", message: err instanceof Error ? err.message : String(err) });
      }
    })();

    return () => {
      live = false;
    };
  }, []);

  const loaded = load.state === "loaded" ? load.cases : EMPTY;

  /**
   * "My cases" has to mean mine.
   *
   * `GET /v1/cases` takes no volunteer filter and answers with the whole system,
   * so an advocate's own list is narrowed here. A case that names no advocate at
   * all is kept: it cannot be shown to belong to someone else, and dropping it
   * would hide a case from the only person who might chase it.
   */
  const all = useMemo(() => {
    const mine = profile.volunteerId;
    if (!mine) return loaded;
    return loaded.filter(
      (item) =>
        (!item.advocateId && !item.advocateName) ||
        item.advocateId === mine ||
        item.advocateName === profile.name,
    );
  }, [loaded, profile.volunteerId, profile.name]);

  const searched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return all;
    return all.filter((item) => item.haystack.includes(needle));
  }, [all, query]);

  const rows = useMemo(() => {
    const active = FILTERS.find((item) => item.id === filter);
    const narrowed = active && active.id !== "all" ? searched.filter(active.match) : searched;
    const sorted = [...narrowed].sort((a, b) => compare(sort, a, b));
    if (!grouped) return sorted;
    // Advocates alphabetically and — because sort is stable — the chosen order
    // kept inside each one. Ordering the flat list here rather than bucketing at
    // render time is what lets "show 40 more" keep paging one list.
    return sorted.sort((a, b) => {
      const left = advocateLabel(a);
      const right = advocateLabel(b);
      // A case nobody holds goes last. It is a gap to close, not an advocate.
      if ((left === UNASSIGNED) !== (right === UNASSIGNED)) return left === UNASSIGNED ? 1 : -1;
      return left.localeCompare(right);
    });
  }, [searched, filter, sort, grouped]);

  /**
   * How large each advocate's group really is, so a header describes the group
   * rather than only the rows paged in so far. `awaiting` is drawn out because it
   * is the one number in the group the supervisor can actually act on.
   */
  const groupSizes = useMemo(() => {
    const sizes = new Map<string, { total: number; awaiting: number }>();
    if (!grouped) return sizes;
    for (const item of rows) {
      const key = advocateKey(item);
      const entry = sizes.get(key) ?? { total: 0, awaiting: 0 };
      entry.total += 1;
      if (item.status === "draft") entry.awaiting += 1;
      sizes.set(key, entry);
    }
    return sizes;
  }, [rows, grouped]);

  /**
   * Counts follow the search rather than the whole caseload, so each entry in the
   * menu answers the question you actually have while typing — how many of these
   * results are still waiting on a supervisor.
   */
  const counts = useMemo(
    () =>
      Object.fromEntries(
        FILTERS.map((item) => [
          item.id,
          item.id === "all" ? searched.length : searched.filter(item.match).length,
        ]),
      ),
    [searched],
  );

  // A narrower list is a different list, and the page you had reached in the old
  // one means nothing in it.
  function narrowing<T>(apply: (value: T) => void) {
    return (value: T) => {
      apply(value);
      setVisible(PAGE);
    };
  }

  if (load.state === "loading") {
    return (
      <Card
        icon="cases"
        title={copy.cases.listing.title}
        fill
        className={layout.fillHeight}
        bodyClassName="flex flex-col justify-center"
      >
        <Loading icon="cases" title="Loading your caseload…" />
      </Card>
    );
  }

  if (load.state === "error") {
    return (
      <Card icon="alert" title={copy.cases.listing.title}>
        <div className="flex items-start gap-3 rounded-control border border-danger/25 bg-danger/5 px-4 py-3">
          <Icon name="alert" size={18} className="mt-0.5 shrink-0 text-danger" />
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-danger">Couldn&apos;t load your caseload</p>
            <p className={cx("mt-1", type_.small)}>{load.message}</p>
          </div>
        </div>
      </Card>
    );
  }

  if (all.length === 0) {
    return (
      <Card icon="cases" title={copy.cases.listing.title}>
        <EmptyState icon="cases" title={copy.cases.none.title} hint={copy.cases.none.hint} />
      </Card>
    );
  }

  const shown = rows.slice(0, visible);
  const narrowed = rows.length !== all.length;

  const total = `${all.length} ${all.length === 1 ? "case" : "cases"}`;
  const advocateCount = groupSizes.size;
  const subtitle = narrowed
    ? `${rows.length} of ${all.length} cases`
    : grouped && advocateCount > 0
      ? `${total} across ${advocateCount} ${advocateCount === 1 ? "advocate" : "advocates"}`
      : total;

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
          onChange={(event) => narrowing(setQuery)(event.target.value)}
          placeholder={copy.cases.searchPlaceholder}
          className={control.input}
        />
        <span className="sr-only">Search</span>
      </label>

      <FilterMenu
        value={filter}
        counts={counts}
        allLabel={copy.cases.filterAll}
        onChange={narrowing(setFilter)}
      />

      {/* Stripped of its native chrome so it reads as the same kind of control as
          the filter beside it, which a menu of icons and counts cannot be. */}
      <label className={cx(control.select, "relative pr-8 focus-within:border-brand/40")}>
        <Icon name="filter" size={15} />
        <span className="sr-only">Sort</span>
        <select
          value={sort}
          onChange={(event) => narrowing(setSort)(event.target.value as SortId)}
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
    </div>
  );

  return (
    <Card
      icon="cases"
      title={copy.cases.listing.title}
      subtitle={subtitle}
      action={controls}
      flush={rows.length > 0}
      // The caseload is the page, so it takes the window: search, filters and the
      // column names stay put at the top, and the rows scroll under them.
      fill
      className={layout.fillHeight}
      // Nothing found: the notice sits in the middle of the space rather than at
      // the top of it, and still spans the card's width.
      bodyClassName={rows.length === 0 ? "flex flex-col justify-center" : undefined}
    >
      {rows.length === 0 ? (
        <EmptyState icon="search" title={copy.cases.empty.title} hint={copy.cases.empty.hint} />
      ) : (
        <>
          <ColumnHeader copy={copy} />
          {grouped ? (
            groupByAdvocate(shown).map((group) => (
              <div key={group.key || group.label}>
                <AdvocateHeader label={group.label} size={groupSizes.get(group.key)} />
                <Rows>
                  {group.items.map((item) => (
                    <CaseRow key={item.id} item={item} now={load.now} copy={copy} />
                  ))}
                </Rows>
              </div>
            ))
          ) : (
            <Rows>
              {shown.map((item) => (
                <CaseRow key={item.id} item={item} now={load.now} copy={copy} />
              ))}
            </Rows>
          )}
          {shown.length < rows.length && (
            <div className="flex flex-wrap items-center justify-center gap-3 border-t border-line px-5 py-4">
              <button
                type="button"
                onClick={() => setVisible((count) => count + PAGE)}
                className={control.secondary}
              >
                Show {Math.min(PAGE, rows.length - shown.length)} more
                <Icon name="chevronDown" size={14} />
              </button>
              <span className={type_.meta}>
                Showing {shown.length} of {rows.length}
              </span>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

/**
 * Who the cases beneath it belong to.
 *
 * Counts describe the whole group, not the rows paged in so far, so the header
 * does not appear to shrink as you scroll. "Waiting on you" is a badge rather
 * than another count because it is the only figure here the supervisor can act
 * on, and it should read differently from the ones they cannot.
 */
function AdvocateHeader({
  label,
  size,
}: {
  label: string;
  size?: { total: number; awaiting: number };
}) {
  const unassigned = label === UNASSIGNED;

  return (
    <div className="flex items-center gap-3 border-b border-line bg-surface-soft/70 px-5 py-2.5">
      {unassigned ? (
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-dashed border-line-strong text-ink-muted">
          <Icon name="user" size={14} />
        </span>
      ) : (
        <Avatar name={label} size={28} variant="accent" />
      )}
      <span
        className={cx(
          "min-w-0 flex-1 truncate text-[12.5px] font-semibold",
          unassigned ? "text-ink-muted italic" : "text-ink",
        )}
      >
        {label}
      </span>
      {size && size.awaiting > 0 && (
        <Badge variant="warn" icon="clock">
          {size.awaiting} waiting on you
        </Badge>
      )}
      {size && (
        <span className={cx("shrink-0 tabular-nums", type_.meta)}>
          {size.total} {size.total === 1 ? "case" : "cases"}
        </span>
      )}
    </div>
  );
}

/**
 * The column track, shared by the header row and every case row so the values
 * line up down the page instead of each row restating its own field names.
 *
 * Below `lg` there is no grid: the columns will not fit, so a row falls back to
 * stacking and every cell labels itself again.
 */
const COLUMNS =
  "lg:grid lg:grid-cols-[minmax(0,2.4fr)_minmax(0,1.4fr)_minmax(0,1.1fr)_minmax(0,0.8fr)_16px] lg:items-center lg:gap-x-4";

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
      {[columns.case, columns.status, columns.deadline, columns.opened].map((label) => (
        <span key={label} className={cx("truncate", type_.label)}>
          {label}
        </span>
      ))}
      <span />
    </div>
  );
}

function CaseRow({
  item,
  now,
  copy,
}: {
  item: CaseRecord;
  now: number;
  copy: ReturnType<typeof useViewer>["copy"];
}) {
  const stalled = item.everyDatePassed && item.status !== "closed";

  return (
    <li>
      <Link
        href={`/cases/${item.id}`}
        className={cx(
          "block border-l-2",
          row.pad,
          row.hover,
          COLUMNS,
          stalled ? "border-l-danger" : "border-l-transparent",
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          {item.name ? (
            <Avatar name={item.name} size={34} variant={stalled ? "danger" : "brand"} />
          ) : (
            // No initial to draw, so the placeholder is a shape rather than an
            // empty circle with nothing in it.
            <span className="flex size-[34px] shrink-0 items-center justify-center rounded-full border border-line-strong bg-surface-muted text-ink-muted">
              <Icon name="user" size={16} />
            </span>
          )}
          <div className="min-w-0">
            <span
              className={cx(
                "block truncate text-[13.5px] font-semibold",
                item.name ? "text-ink" : "text-ink-muted",
              )}
            >
              {item.name || copy.cases.unnamed}
            </span>
            <span className={cx("block truncate", type_.monoSmall)}>{item.id}</span>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5 lg:mt-0">
          <CaseStatus status={item.status} />
          {stalled && (
            <Badge variant="danger" icon="alert">
              Every date has passed
            </Badge>
          )}
        </div>

        {/* `lg:contents` dissolves this wrapper into the row's own grid, so the
            two cells become columns there and a stacked block below it. */}
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-3 lg:contents">
          <Cell label={copy.cases.columns.deadline}>
            {item.nextDue === null ? (
              <span className="text-ink-muted">—</span>
            ) : (
              <span className="tabular-nums">
                {DATE.format(item.nextDue)}
                <span className="text-ink-muted"> · {dueLabel(item.nextDue, now)}</span>
              </span>
            )}
          </Cell>
          <Cell label={copy.cases.columns.opened}>
            <span className="tabular-nums">{openedLabel(item.openedAt, now)}</span>
          </Cell>
        </div>

        <Icon name="chevronRight" size={16} className="hidden shrink-0 text-ink-muted lg:block" />
      </Link>
    </li>
  );
}

/**
 * Where the case stands. A case that is simply being watched is the ordinary
 * condition of a caseload, so it reads as a dot and a phrase; the states that
 * are waiting on someone or finished are the ones that get a badge.
 */
function CaseStatus({ status }: { status: string }) {
  const meta = statusMeta(status);
  if (!meta.quiet) {
    return (
      <Badge variant={meta.variant} icon={meta.icon}>
        {meta.label}
      </Badge>
    );
  }
  return (
    <span className={cx("flex min-w-0 items-center gap-2", type_.small)}>
      <Dot variant={meta.variant} />
      <span className="truncate">{meta.label}</span>
    </span>
  );
}

/**
 * One value in the table. The label is the column header's job at `lg`; below
 * that there is no header, so the cell carries it.
 */
function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className={cx("lg:hidden", type_.label)}>{label}</p>
      <div className="mt-1 min-w-0 truncate text-[12.5px] text-ink-soft lg:mt-0">{children}</div>
    </div>
  );
}

/**
 * Named slices of the caseload, one at a time. As chips they were a second row
 * of controls wide enough to push the list itself below the fold, and the four
 * you were not using outnumbered the one you were.
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

  const label = (option: CaseFilter) => (option.id === "all" ? allLabel : option.label);
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
