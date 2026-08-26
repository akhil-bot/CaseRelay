"use client";

import { Card, DOMAIN_META, cx } from "@/components/ui/primitives";
import { tone, type Tone } from "@/design/tokens";
import type { CaseRunSummary, RunEvent } from "@/lib/api";
import {
  commitmentDeadlines,
  formatMoment,
  nextFollowUpAt,
  parseTime,
  scaleFor,
  useNow,
  type TimeScale,
} from "@/lib/case-events";

/** A round of outreach: from the moment the run started to its last event. */
interface Band {
  id: string;
  start: number;
  end: number;
  label: string;
  variant: Tone;
}

/** A single date the case carries — a referral, a confirmation, a deadline. */
interface Mark {
  at: number;
  label: string;
  variant: Tone;
}

/** Room at each end so a mark sitting on the first or last date is not clipped. */
const EDGE_PAD = 5;

function buildBands(runs: CaseRunSummary[], events: RunEvent[], now: number): Band[] {
  const lastEventAt = new Map<string, number>();
  for (const ev of events) {
    const at = parseTime(ev.timestamp);
    if (!ev.run_id || at === null) continue;
    const seen = lastEventAt.get(ev.run_id);
    if (seen === undefined || at > seen) lastEventAt.set(ev.run_id, at);
  }

  return runs
    .map((run) => ({ run, start: parseTime(run.created_at) }))
    .filter((entry): entry is { run: CaseRunSummary; start: number } => entry.start !== null)
    .sort((a, b) => a.start - b.start)
    .map(({ run, start }, i) => {
      const running = run.state === "running" || run.state === "queued";
      const end = running ? now : Math.max(lastEventAt.get(run.run_id) ?? start, start);
      return {
        id: run.run_id,
        start,
        end,
        label: `Round ${i + 1} of outreach`,
        variant: run.state === "failed" ? ("danger" as Tone) : ("brand" as Tone),
      };
    });
}

/**
 * Every date the case actually carries, and nothing else. A commitment whose
 * deadline has never been reported is absent from the rail rather than guessed
 * at, and no date is derived from the position of another.
 */
function buildMarks(
  caseData: Record<string, unknown>,
  commitments: Record<string, string>,
  events: RunEvent[],
  now: number,
): Mark[] {
  const marks: Mark[] = [];

  const referral = parseTime(caseData.created_at);
  if (referral !== null) marks.push({ at: referral, label: "Referral", variant: "neutral" });

  const activated = parseTime(caseData.activated_at);
  if (activated !== null && activated !== referral) {
    marks.push({ at: activated, label: "Confirmed", variant: "brand" });
  }

  for (const [domain, deadline] of commitmentDeadlines(events)) {
    const met = commitments[domain] === "completed";
    marks.push({
      at: deadline,
      label: `${DOMAIN_META[domain].label} due`,
      variant: met ? "seal" : deadline <= now ? "danger" : "accent",
    });
  }

  // Only while it is still ahead. Once the wake has fired the case has already
  // checked back, and the round that did it is on the rail as its own band.
  const followUp = nextFollowUpAt(events);
  if (followUp !== null && followUp > now && !marks.some((m) => m.at === followUp)) {
    marks.push({ at: followUp, label: "Next follow-up", variant: "accent" });
  }

  return marks.sort((a, b) => a.at - b.at);
}

/** Real midnights inside the span, thinned so a long case does not turn into a comb. */
function dayBoundaries(start: number, end: number): number[] {
  const midnights: number[] = [];
  const cursor = new Date(start);
  cursor.setHours(24, 0, 0, 0);
  while (cursor.getTime() < end && midnights.length < 60) {
    midnights.push(cursor.getTime());
    cursor.setDate(cursor.getDate() + 1);
  }
  const step = Math.ceil(midnights.length / 8) || 1;
  return midnights.filter((_, i) => i % step === 0);
}

export function CaseTimeline({
  caseData,
  commitments,
  runs,
  events,
}: {
  caseData: Record<string, unknown>;
  commitments: Record<string, string>;
  runs: CaseRunSummary[];
  events: RunEvent[];
}) {
  const now = useNow();
  const bands = buildBands(runs, events, now);
  const marks = buildMarks(caseData, commitments, events, now);

  // Before the first round of outreach there is a date but no story, and the
  // page already says outreach has not started.
  if (now === 0 || bands.length === 0) return null;

  const points = [...bands.flatMap((b) => [b.start, b.end]), ...marks.map((m) => m.at), now];
  const start = Math.min(...points);
  const end = Math.max(...points);
  if (end <= start) return null;

  const scale: TimeScale = scaleFor(end - start);
  const at = (t: number) => EDGE_PAD + ((t - start) / (end - start)) * (100 - EDGE_PAD * 2);
  const nowAt = at(now);

  // Label what fits. Everything keeps its tick and its tooltip; only the words
  // are dropped, so a case whose deadlines are a minute apart stays readable.
  const labelled: Mark[] = [];
  for (const mark of marks) {
    const pos = at(mark.at);
    if (Math.abs(pos - nowAt) < 7) continue;
    const last = labelled[labelled.length - 1];
    if (last && pos - at(last.at) < 12) continue;
    labelled.push(mark);
  }

  const spoken = [
    `${bands.length} round${bands.length === 1 ? "" : "s"} of outreach`,
    ...marks.map((m) => `${m.label} ${formatMoment(m.at, scale)}`),
  ].join(", ");

  return (
    <Card
      icon="history"
      title="Case timeline"
      subtitle="What has happened, and what is still due."
    >
      <div className="relative h-[76px] w-full" role="img" aria-label={spoken}>
        {scale === "day" &&
          dayBoundaries(start, end).map((ms) => (
            <span
              key={ms}
              className="absolute top-[24px] h-[10px] w-px bg-line"
              style={{ left: `${at(ms)}%` }}
              aria-hidden="true"
            />
          ))}

        <span
          className="absolute top-[26px] right-0 left-0 h-1.5 rounded-full bg-surface-muted"
          aria-hidden="true"
        />

        {bands.map((band) => (
          <span
            key={band.id}
            className={cx("absolute top-[26px] h-1.5 rounded-full", tone[band.variant].bar)}
            style={{
              left: `${at(band.start)}%`,
              width: `${Math.max(at(band.end) - at(band.start), 1.5)}%`,
            }}
            title={`${band.label} — ${formatMoment(band.start, scale)}`}
          />
        ))}

        {marks.map((mark) => (
          <span
            key={`${mark.at}-${mark.label}`}
            className={cx(
              "absolute top-[23px] size-[11px] -translate-x-1/2 rounded-full border-2 border-surface",
              tone[mark.variant].dot,
            )}
            style={{ left: `${at(mark.at)}%` }}
            title={`${mark.label} — ${formatMoment(mark.at, scale)}`}
          />
        ))}

        <span
          className="absolute top-[16px] h-[22px] w-px bg-ink-muted/50"
          style={{ left: `${nowAt}%` }}
          aria-hidden="true"
        />
        <span
          className="absolute top-0 -translate-x-1/2 text-[10.5px] font-medium whitespace-nowrap text-ink-soft"
          style={{ left: `${Math.min(Math.max(nowAt, 6), 94)}%` }}
        >
          today
        </span>

        {labelled.map((mark) => (
          <span
            key={`label-${mark.at}-${mark.label}`}
            className="absolute top-[42px] block -translate-x-1/2 text-center text-[10.5px] leading-[14px] whitespace-nowrap text-ink-muted"
            style={{ left: `${Math.min(Math.max(at(mark.at), 6), 94)}%` }}
          >
            {mark.label}
            <span className="block font-mono tabular-nums">{formatMoment(mark.at, scale)}</span>
          </span>
        ))}
      </div>
    </Card>
  );
}
