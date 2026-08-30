"use client";

import { useState } from "react";
import { Icon, type IconName } from "@/components/icons";
import { cx, surface, type as type_ } from "@/design/tokens";
import {
  BACKGROUND_BLANKS,
  CLOSING_BLANKS,
  formatReportDate,
  reportFilename,
  reportToMarkdown,
} from "@/lib/copilot/report";
import { downloadText, useReportStore } from "@/lib/copilot/report-store";
import { useBeginOutreach } from "@/lib/copilot/outreach";

/**
 * The two things the assistant draws rather than describes.
 *
 * A widget earns its place here only where prose is the wrong medium: a case
 * about to be worked needs a decision from a person, and a report needs to leave
 * the browser as a file. Everything else the assistant does stays as a sentence
 * and a quiet step line — see the note on WIDGET_TOOLS in chat-parts.tsx.
 *
 * Both are built for the 492px panel, so facts wrap as pairs rather than sitting
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
 * overflow a 492px panel once it has its own 32px of inset, so the chat gets its
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
  const beginOutreach = useBeginOutreach();
  const [phase, setPhase] = useState<"idle" | "starting" | "started">("idle");
  const [error, setError] = useState<string | null>(null);

  if (status !== "complete") return <Pending title="Setting up the case…" />;

  const parsed = parseResult(result);
  if (!parsed) return <Failed message={result || "The case could not be set up."} />;

  const caseId = str(parsed.case_id);
  const childName = str(parsed.child_name) || caseId;
  const dueAt = str(parsed.due_at);

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
      title={`${childName} — ready for outreach`}
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

// ─── Report, with both downloads on it ──────────────────────────────────────

/**
 * A finished report, and the two ways to take it away.
 *
 * The card shows counts rather than the report itself: the markdown is already
 * in the thread above, and repeating a document inside a 492px panel helps
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
