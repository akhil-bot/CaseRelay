"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/icons";
import { Avatar, FlagBadge, cx } from "@/components/ui/primitives";
import { control, surface, type as type_ } from "@/design/tokens";
import { useDemo } from "@/lib/demo-store";
import { useViewer } from "@/lib/viewer";
import type { CaseSummary } from "@/lib/types";

const MAX_RESULTS = 6;

const optionId = (index: number) => `case-search-option-${index}`;

/**
 * Jump-to-case search. Ranked so an exact alias or case number wins over a
 * mention buried in a headline, because that is what someone typing a name
 * expects. Enter opens the highlighted case; the last row hands the same query
 * to the full list on /cases.
 */
export function CaseSearch() {
  const { cases } = useDemo();
  const { copy, showsTechnical } = useViewer();
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const needle = query.trim().toLowerCase();
  const matches = useMemo(() => (needle ? rank(cases, needle) : []), [cases, needle]);
  const results = matches.slice(0, MAX_RESULTS);
  const expanded = open && needle.length > 0;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  function goTo(href: string) {
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
    router.push(href);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (!expanded) return;

    // One past the last result is the "see all matches" row.
    const lastIndex = results.length;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => (index >= lastIndex ? 0 : index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => (index <= 0 ? lastIndex : index - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const target = results[active];
      goTo(target ? `/cases/${target.id}` : `/cases?q=${encodeURIComponent(query.trim())}`);
    }
  }

  return (
    <div ref={containerRef} className="relative hidden md:block md:w-60 xl:w-72 2xl:w-80">
      <label className="relative block">
        <Icon
          name="search"
          size={15}
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-muted"
        />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={expanded}
          aria-controls="case-search-results"
          aria-activedescendant={expanded ? optionId(active) : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          value={query}
          placeholder={copy.cases.searchPlaceholder}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            // The result set just changed under the highlight.
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className={cx(control.input, "pr-16")}
        />
        <span className="sr-only">Search cases</span>
        {query.length === 0 ? (
          <Shortcut />
        ) : (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full p-1 text-ink-muted transition-colors hover:text-ink"
          >
            <Icon name="close" size={14} />
          </button>
        )}
      </label>

      {expanded && (
        <div
          id="case-search-results"
          role="listbox"
          className={cx(surface.pop, "animate-rise absolute top-11 right-0 z-30 w-[min(420px,80vw)] p-1.5")}
        >
          {results.length === 0 && (
            <p className={cx("px-3 py-4 text-center", type_.small)}>
              Nothing matches <span className="font-medium text-ink">{query.trim()}</span>.
            </p>
          )}

          {results.map((item, index) => (
            <button
              key={item.id}
              type="button"
              id={optionId(index)}
              role="option"
              aria-selected={index === active}
              onMouseEnter={() => setActive(index)}
              onClick={() => goTo(`/cases/${item.id}`)}
              className={cx(
                "flex w-full items-start gap-2.5 rounded-control px-2.5 py-2 text-left transition-colors",
                index === active ? "bg-brand-soft" : "hover:bg-surface-soft",
              )}
            >
              <Avatar
                name={showsTechnical ? item.id.replace("CR-", "W ") : item.childAlias}
                size={30}
                variant={
                  item.flags.some((flag) => flag === "overdue" || flag === "blocked")
                    ? "danger"
                    : "neutral"
                }
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-[13px] font-medium text-ink">
                    {showsTechnical ? item.id : item.childAlias}
                  </span>
                  <span className="shrink-0 font-mono text-[10.5px] text-ink-muted">
                    {showsTechnical ? item.childAlias : item.id}
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-[11.5px] text-ink-soft">
                  {item.headline}
                </span>
              </span>
              {item.flags[0] && (
                <span className="hidden shrink-0 lg:block">
                  <FlagBadge flag={item.flags[0]} />
                </span>
              )}
            </button>
          ))}

          <button
            type="button"
            id={optionId(results.length)}
            role="option"
            aria-selected={active === results.length}
            onMouseEnter={() => setActive(results.length)}
            onClick={() => goTo(`/cases?q=${encodeURIComponent(query.trim())}`)}
            className={cx(
              "mt-1 flex w-full items-center gap-2 rounded-control border-t border-line px-2.5 py-2 text-[12px] font-medium text-brand-deep transition-colors",
              active === results.length ? "bg-brand-soft" : "hover:bg-surface-soft",
            )}
          >
            <Icon name="filter" size={14} />
            {matches.length > results.length
              ? `See all ${matches.length} matches in the list`
              : "Open the full list with this search"}
            <Icon name="arrowRight" size={14} className="ml-auto" />
          </button>
        </div>
      )}
    </div>
  );
}

/** Read once from the browser, without a render-time SSR mismatch. */
const noSubscribe = () => () => {};

function Shortcut() {
  const modifier = useSyncExternalStore(
    noSubscribe,
    () => (navigator.userAgent.includes("Mac") ? "⌘" : "Ctrl"),
    () => "⌘",
  );

  return (
    <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 rounded border border-line-strong bg-surface px-1.5 py-0.5 font-mono text-[10.5px] text-ink-muted">
      {modifier}K
    </span>
  );
}

/** Alias and case-number hits rank above county, court order, or headline text. */
function rank(cases: CaseSummary[], needle: string) {
  return cases
    .map((item) => {
      const alias = item.childAlias.toLowerCase();
      const id = item.id.toLowerCase();
      let score = 0;
      if (alias.startsWith(needle) || id.startsWith(needle)) score = 4;
      else if (alias.includes(needle) || id.includes(needle)) score = 3;
      else if ([item.county, item.courtOrder, item.supervisor, item.volunteer].join(" ").toLowerCase().includes(needle))
        score = 2;
      else if (item.headline.toLowerCase().includes(needle)) score = 1;
      return { item, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.item.childAlias.localeCompare(b.item.childAlias))
    .map((entry) => entry.item);
}
