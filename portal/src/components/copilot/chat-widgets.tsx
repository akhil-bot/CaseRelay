"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon, type IconName } from "@/components/icons";
import { cx, row, surface, type as type_ } from "@/design/tokens";
import { statusMeta } from "@/lib/caseload";
import {
  BACKGROUND_BLANKS,
  CLOSING_BLANKS,
  formatReportDate,
  reportFilename,
  reportToMarkdown,
} from "@/lib/copilot/report";
import { downloadText, useReportStore } from "@/lib/copilot/report-store";
import { useBeginOutreach } from "@/lib/copilot/outreach";
import { useTakeOnCase, type CaseTakenOn } from "@/lib/copilot/take-on";

/**
 * The things the assistant draws rather than describes.
 *
 * A widget earns its place here only where prose is the wrong medium: a list of
 * children to choose between is a question whose answer is a click, a case about
 * to be worked needs a decision from a person, and a report needs to leave the
 * browser as a file. Everything else stays as a sentence and a quiet step line —
 * see the note on WIDGET_TOOLS in chat-parts.tsx.
 *
 * All are built for the 560px panel, so facts wrap as pairs rather than sitting
 * in a table that would need to scroll sideways.
 */

/** A tool result, which arrives as a string and may not be the JSON we asked for. */
function parseResult(result: string | undefined): Record<string, unknown> | null {
  if (!result) return null;
  try {
    const parsed: unknown = JSON.parse(result);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    // Handlers return a plain sentence on failure. That is not a shape to draw a
    // card around, so the caller falls back to showing it as the message it is.
    return null;
  }
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// ─── Shared shell ────────────────────────────────────────────────────────────

/**
 * The frame both widgets share: an inset panel, never a card.
 *
 * A card is the product's one elevated surface, and the thread is already inside
 * the chat panel — a second elevation here would read as a page within a page.
 * `surface.inset` is the same treatment the rest of the app gives something
 * nested one level deep.
 */
function WidgetShell({
  icon,
  title,
  subtitle,
  children,
  footer,
}: {
  icon: IconName;
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <section className={cx(surface.inset, "mt-2 overflow-hidden")}>
      <div className="flex items-start gap-2.5 px-3.5 pt-3">
        <span className="mt-px flex size-6 shrink-0 items-center justify-center rounded-control bg-brand-soft text-brand-deep">
          <Icon name={icon} size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] leading-snug font-semibold text-ink">{title}</p>
          {subtitle && <p className={cx("mt-0.5", type_.meta)}>{subtitle}</p>}
        </div>
      </div>

      {children && <div className="px-3.5 pt-3">{children}</div>}

      {footer && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line bg-surface px-3.5 py-2.5">
          {footer}
        </div>
      )}
      {!footer && <div className="pb-3.5" />}
    </section>
  );
}

/** Label over value, two to a row. The panel is too narrow for anything wider. */
function Facts({ rows }: { rows: [string, string][] }) {
  if (rows.length === 0) return null;
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5">
      {rows.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className={type_.label}>{label}</dt>
          <dd className="mt-0.5 truncate text-[12.5px] font-medium text-ink" title={value}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A button sized for the panel rather than the page.
 *
 * `control.primary` and its siblings are built for a page's action bar, where
 * 13px text and 14px of side padding sit correctly. Two of those side by side
 * overflow a 560px panel once it has its own 32px of inset, so the chat gets its
 * own smaller pair. Written out in full rather than composed with the tokens,
 * because a competing `hover:` utility would otherwise resolve by stylesheet
 * order instead of by the order it is passed.
 */
const BUTTON = {
  primary:
    "inline-flex items-center justify-center gap-1.5 rounded-control bg-brand px-3 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-brand-deep disabled:opacity-40",
  secondary:
    "inline-flex items-center justify-center gap-1.5 rounded-control border border-line-strong bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink-soft transition-colors hover:bg-surface-soft hover:text-ink disabled:opacity-40",
} as const;

/** Waiting on the tool. Shaped like the card it becomes, so nothing jumps. */
function Pending({ title }: { title: string }) {
  return (
    <section className={cx(surface.inset, "mt-2 px-3.5 py-3")}>
      <div className="flex items-center gap-2.5">
        <span className="size-4 shrink-0 animate-spin rounded-full border-2 border-brand border-t-transparent" />
        <p className={cx(type_.small, "motion-safe:animate-pulse")}>{title}</p>
      </div>
    </section>
  );
}

/** A handler that returned a sentence instead of a record. Say it plainly. */
function Failed({ message }: { message: string }) {
  return (
    <section className="mt-2 flex items-start gap-2.5 rounded-control border border-danger/25 bg-danger/5 px-3.5 py-3">
      <Icon name="alert" size={15} className="mt-px shrink-0 text-danger" />
      <p className={cx(type_.small, "min-w-0")}>{message}</p>
    </section>
  );
}

// ─── Case review, with the outreach decision on it ───────────────────────────

export interface WidgetProps {
  status: string;
  result?: string;
}

/**
 * A case the assistant has just set up, and the one thing to do with it.
 *
 * This is the widget the demo turns on: the case is created, its facts are on
 * screen to be read, and starting outreach is a button rather than a second
 * sentence typed into the composer. The decision stays with the person — the
 * assistant sets a case up and stops.
 *
 * The button is not a shortcut for talking to the assistant; it runs the same
 * `useBeginOutreach` the tool does, so a run started here is indistinguishable
 * from one started by asking.
 */
export function CaseReviewWidget({ status, result }: WidgetProps) {
  if (status !== "complete") return <Pending title="Setting up the case…" />;

  const parsed = parseResult(result);
  if (!parsed) return <Failed message={result || "The case could not be set up."} />;

  return (
    <CaseReview
      caseId={str(parsed.case_id)}
      childName={str(parsed.child_name) || str(parsed.case_id)}
      dueAt={str(parsed.due_at)}
    />
  );
}

/**
 * The card itself, given a case rather than a tool result.
 *
 * Split out because a case can reach this state two ways — the assistant set it
 * up, or the volunteer picked the child off the list below — and both should
 * arrive at the same card with the same button on it.
 */
function CaseReview({
  caseId,
  childName,
  dueAt,
}: {
  caseId: string;
  childName: string;
  dueAt: string;
}) {
  const beginOutreach = useBeginOutreach();
  const [phase, setPhase] = useState<"idle" | "starting" | "started">("idle");
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (!caseId) return;
    setPhase("starting");
    setError(null);
    try {
      await beginOutreach(caseId);
      setPhase("started");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("idle");
    }
  }

  return (
    <WidgetShell
      icon="cases"
      title={`${childName || caseId} — ready for outreach`}
      subtitle="Nothing has been sent yet. Outreach begins when you say so."
      footer={
        phase === "started" ? (
          <p className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-brand-deep">
            <Icon name="check" size={14} />
            Outreach started — opening the live view
          </p>
        ) : (
          <>
            <button
              type="button"
              onClick={start}
              disabled={phase === "starting" || !caseId}
              className={BUTTON.primary}
            >
              <Icon name="play" size={13} />
              {phase === "starting" ? "Starting…" : "Start outreach"}
            </button>
            {error && <span className="text-[12px] text-danger">{error}</span>}
          </>
        )
      }
    >
      <Facts
        rows={[
          ["Case", caseId || "—"],
          ["Deadline", dueAt ? formatReportDate(dueAt) : "—"],
        ]}
      />
    </WidgetShell>
  );
}

// ─── The children waiting, as a list to pick from ────────────────────────────

/** Whatever the handler listed, as strings, with anything unusable dropped. */
function items(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => str(entry) !== "") : [];
}

/**
 * The children whose referrals are waiting, each one a case that can be taken on.
 *
 * A list of nine names followed by "which would you like?" is a question with
 * nine answers, and prose is the wrong medium for that: it asks the volunteer to
 * type back something already on screen, and to spell it the way the assistant
 * did. Drawn as rows, the answer is the click.
 *
 * Rows rather than a wrapped run of chips. Chips put a border and a fill around
 * each name, which is the treatment the product reserves for a card, so nine of
 * them read as nine objects to weigh up rather than one list to scan; and with
 * names of uneven length, no two lines start in the same place. Hairline-divided
 * rows are what the rest of the app uses for a list of people — see the note on
 * `row` in tokens.ts — and one name per line gives the eye a single column to
 * run down.
 *
 * The list is whatever the handler returned rather than a fixed set, so a
 * scenario added to the control plane appears here without this component
 * knowing anything about it.
 *
 * Only first names, deliberately. The rest of each record — the internal id, the
 * complexity rating, the expected outcome — is written for whoever is exercising
 * the system, and putting it in front of a volunteer would read as though the
 * child were a test fixture. Same reason the handler keeps it out of the model's
 * context.
 */
export function ChildChoiceWidget({ status, result }: WidgetProps) {
  const takeOnCase = useTakeOnCase();
  const [taking, setTaking] = useState<string | null>(null);
  const [taken, setTaken] = useState<CaseTakenOn | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Once a child is chosen the question is answered, so the list gives way to
  // the case rather than sitting above it still asking.
  if (taken) {
    return <CaseReview caseId={taken.caseId} childName={taken.childName} dueAt={taken.dueAt} />;
  }

  if (status !== "complete") return <Pending title="Checking who is waiting…" />;

  const parsed = parseResult(result);
  const children = items(parsed?.children);
  if (children.length === 0) {
    return <Failed message={result || "Nobody is waiting for an advocate just now."} />;
  }

  async function choose(child: string) {
    setTaking(child);
    setError(null);
    try {
      setTaken(await takeOnCase(child));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTaking(null);
    }
  }

  return (
    <WidgetShell
      icon="users"
      title="Waiting for an advocate"
      subtitle={`${children.length} ${children.length === 1 ? "child" : "children"} whose referrals are ready. Pick one to open the case.`}
      footer={error ? <span className="text-[12px] text-danger">{error}</span> : undefined}
    >
      {/*
        Bled past the shell's inset so the hairlines reach both edges, which is
        what makes a run of rows read as one list rather than a stack of tiles.
      */}
      <ul className={cx("-mx-3.5 border-t border-line", row.divide)}>
        {children.map((child) => {
          const busy = taking === child;
          return (
            <li key={child}>
              <button
                type="button"
                onClick={() => void choose(child)}
                // One at a time. Two cases opening at once from one list is
                // never what was meant, and the second would land on a card the
                // first has already replaced.
                disabled={taking !== null}
                aria-label={`Take on ${child}'s case`}
                className={cx(
                  "group flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors",
                  // `row.hover` tints towards `surface-soft`, which is already
                  // the shell's own fill here — so the lift goes the other way,
                  // towards the plain surface, to be visible at all.
                  busy ? "bg-brand-soft/60" : "hover:bg-surface disabled:opacity-40",
                )}
              >
                <span
                  className={cx(
                    "flex size-6 shrink-0 items-center justify-center rounded-full",
                    "text-[11px] font-semibold transition-colors",
                    busy ? "bg-brand text-white" : "bg-brand-soft text-brand-deep",
                  )}
                  aria-hidden
                >
                  {child.slice(0, 1).toUpperCase()}
                </span>

                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
                  {child}
                </span>

                {busy ? (
                  <span className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-brand border-t-transparent" />
                ) : (
                  <Icon
                    name="chevronRight"
                    size={14}
                    className="shrink-0 text-ink-muted transition-colors group-hover:text-brand"
                  />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </WidgetShell>
  );
}

// ─── The advocate's own caseload, as a list to open ──────────────────────────

/** A case as the handler passes it along: already narrowed to the viewer. */
interface ListedCase {
  caseId: string;
  childName: string;
  status: string;
}

function listedCases(value: unknown): ListedCase[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const row_ = entry as Record<string, unknown>;
      return {
        caseId: str(row_.case_id),
        childName: str(row_.child_name),
        status: str(row_.status),
      };
    })
    .filter((entry) => entry.caseId !== "");
}

/**
 * The cases belonging to whoever is signed in.
 *
 * Only theirs. The narrowing is `ownedBy` in lib/caseload.ts, the same rule the
 * My Cases screen applies, and it is shared rather than repeated so the chat
 * cannot turn into a way to read a case that screen withheld. A supervisor or an
 * admin has no `volunteerId` and so owns the whole team's caseload — that is the
 * point of those roles, not a hole in the rule.
 *
 * Rows carry the child, not the case id. An advocate knows the child's name; the
 * id is scaffolding, and it is already in the link this row opens.
 */
export function CaseListWidget({ status, result }: WidgetProps) {
  const router = useRouter();

  if (status !== "complete") return <Pending title="Reading your caseload…" />;

  const parsed = parseResult(result);
  if (!parsed) return <Failed message={result || "Your caseload could not be read."} />;

  const cases = listedCases(parsed.cases);

  if (cases.length === 0) {
    return (
      <WidgetShell
        icon="cases"
        title="No cases yet"
        subtitle="Nothing is assigned to you. Ask who needs an advocate to take one on."
      />
    );
  }

  return (
    <WidgetShell
      icon="cases"
      title="Your cases"
      subtitle={`${cases.length} ${cases.length === 1 ? "case" : "cases"} assigned to you. Open one to see where it stands.`}
    >
      <ul className={cx("-mx-3.5 border-t border-line", row.divide)}>
        {cases.map((item) => {
          const meta = statusMeta(item.status);
          return (
            <li key={item.caseId}>
              <button
                type="button"
                onClick={() => router.push(`/cases/${item.caseId}`)}
                aria-label={`Open ${item.childName || item.caseId}'s case`}
                className={cx(
                  "group flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left",
                  "transition-colors hover:bg-surface",
                )}
              >
                <span
                  className={cx(
                    "flex size-6 shrink-0 items-center justify-center rounded-full",
                    "bg-brand-soft text-[11px] font-semibold text-brand-deep",
                  )}
                  aria-hidden
                >
                  {(item.childName || item.caseId).slice(0, 1).toUpperCase()}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink">
                    {item.childName || item.caseId}
                  </span>
                  <span className={cx("block truncate", type_.meta)}>{meta.label}</span>
                </span>

                <Icon
                  name="chevronRight"
                  size={14}
                  className="shrink-0 text-ink-muted transition-colors group-hover:text-brand"
                />
              </button>
            </li>
          );
        })}
      </ul>
    </WidgetShell>
  );
}

// ─── Report, with both downloads on it ──────────────────────────────────────

/**
 * A finished report, and the two ways to take it away.
 *
 * The card shows counts rather than the report itself: the markdown is already
 * in the thread above, and repeating a document inside a 560px panel helps
 * nobody. What the card adds is the file.
 *
 * Both routes are entirely local. The `.md` is a Blob built from a string
 * already in memory; the PDF is the browser's own print pipeline against a
 * hidden document. Nothing about a child's case is posted anywhere to produce
 * either, which is the whole reason it works this way.
 *
 * The download reads the stored report rather than the markdown the assistant
 * relayed, so even if the model paraphrases what it was handed, the saved file
 * is the case's own record.
 */
export function ReportWidget({ status, result }: WidgetProps) {
  const { reports, print } = useReportStore();

  if (status !== "complete") return <Pending title="Reading the case record…" />;

  const parsed = parseResult(result);
  if (!parsed) return <Failed message={result || "The report could not be assembled."} />;

  const caseId = str(parsed.case_id);
  const report = reports[caseId];

  if (!report) {
    return <Failed message={`The report for ${caseId || "this case"} is no longer in memory.`} />;
  }

  const { counts } = report;

  return (
    <WidgetShell
      icon="document"
      title={`Court report — ${report.childName}`}
      subtitle={`Assembled ${formatReportDate(report.generatedAt)} from the case record. Sections needing your own account are left blank.`}
      footer={
        <>
          <button
            type="button"
            onClick={() => downloadText(reportFilename(report, "md"), reportToMarkdown(report), "text/markdown")}
            className={BUTTON.primary}
          >
            <Icon name="download" size={13} />
            Download .md
          </button>
          <button type="button" onClick={() => print(report)} className={BUTTON.secondary}>
            <Icon name="printer" size={13} />
            Save as PDF
          </button>
        </>
      }
    >
      <Facts
        rows={[
          ["Commitments", `${counts.settled} of ${counts.commitments} settled`],
          ["Still owed", `${report.outstanding.length} outstanding`],
          ["Organisations contacted", String(report.contacts.length)],
          ["Findings", `${report.findings.length} services`],
          ["For you to write", `${CLOSING_BLANKS.length + BACKGROUND_BLANKS.length + 1} sections`],
        ]}
      />
    </WidgetShell>
  );
}
