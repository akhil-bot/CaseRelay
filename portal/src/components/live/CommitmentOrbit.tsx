"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { Icon, type IconName } from "@/components/icons";
import { LogoMark } from "@/components/Logo";
import {
  DOMAIN_META,
  StatusBadge,
  isCommitmentStatus,
  statusLabel,
  cx,
} from "@/components/ui/primitives";
import { surface, tone, type Tone, type as type_ } from "@/design/tokens";
import type { RunEvent } from "@/lib/api";
import {
  STATUS_TONE,
  commitmentDeadlines,
  commitmentLabels,
  eventDomain,
  isClosed,
  useNow,
} from "@/lib/case-events";
import type { Domain } from "@/lib/types";

/**
 * ── The commitments, as one picture ──────────────────────────────────────────
 * A case is one child and the handful of services that owe them something. A
 * list says that badly: five rows of equal weight, each carrying a status word,
 * and nothing to say which of them the case is actually stuck on.
 *
 * So the services sit around the child instead. Each one carries an arc of how
 * far it has got, and the line back to the centre breaks where nobody has
 * answered — which is the one thing a volunteer is scanning for. Resting on a
 * service tells you what happened there in the words the case itself recorded.
 *
 * Every service the product knows about holds its place in the ring from the
 * first paint, so the figure never grows a node or rotates the others as more
 * commitments land. A service this case has asked nothing of is drawn as the
 * empty slot it is, and says so when you rest on it.
 *
 * Nothing here is generated prose. The sentence in the panel is the message the
 * control plane wrote for that event; where the case has recorded nothing, the
 * panel says so rather than describing an absence as if it were a state.
 */

// ─── Geometry ─────────────────────────────────────────────────────────────────
//
// One coordinate space, sized in the SVG's own units and projected to
// percentages for the HTML that sits on top. Both halves therefore scale with
// the box, and a node's ring cannot drift away from the node it belongs to.

const BOX = 460;
const CENTRE = BOX / 2;
const HUB_R = 54;
const ORBIT_R = 152;
const NODE_R = 33;
/** Clear of the node's own edge, so the arc reads as a ring around it. */
const NODE_RING_R = NODE_R + 6;
const HUB_RING_R = HUB_R + 7;

const NODE_RING_C = 2 * Math.PI * NODE_RING_R;
const HUB_RING_C = 2 * Math.PI * HUB_RING_R;

const pct = (value: number) => `${(value / BOX) * 100}%`;

// ─── Reading one commitment ───────────────────────────────────────────────────

/** The mark a node wears in its corner, for the states worth spotting from across the page. */
const STATUS_MARK: Record<string, IconName> = {
  completed: "checkCircle",
  blocked: "alert",
  unresolved: "alert",
  scheduled: "calendar",
};

/**
 * How far a service has got, in the three steps the record can actually
 * evidence: we asked, they came back, it settled. A fourth step would have to
 * be inferred, so there are three.
 */
const STAGES = 3;

function stagesReached(events: RunEvent[], status: string): number {
  if (isClosed(status)) return STAGES;
  const answered = events.some(
    (ev) =>
      ev.event === "phase_complete" ||
      ev.event === "disclosure" ||
      ev.event === "denial" ||
      ev.event === "commitment_deferred",
  );
  if (answered) return 2;
  return events.length > 0 ? 1 : 0;
}

interface OrbitNode {
  type: string;
  /** The service, as a volunteer would name it: "School", "Clinic". */
  label: string;
  /** What was asked of it, where a run has summarised the case in its own words. */
  title: string;
  icon: IconName;
  /** The service's own colour, so a node is recognisable before it is read. */
  variant: Tone;
  status: string;
  statusTone: Tone;
  mark: IconName | null;
  stage: number;
  events: RunEvent[];
  deadline: number | null;
  /** The case carries a commitment here at all, rather than holding the slot open. */
  tracked: boolean;
  /** Nothing is coming back on its own: the line to the centre is drawn broken. */
  stalled: boolean;
  x: number;
  y: number;
  /** The spoke, bowed slightly so five of them read as an orbit and not a star. */
  spoke: string;
}

const DOMAIN_ORDER = Object.keys(DOMAIN_META);

/**
 * Which services the ring holds a place for, in a fixed order.
 *
 * Every domain the product has a glyph for, always, whether or not this case
 * has asked anything of it — a case's commitments are extracted a service at a
 * time, and a ring built from only the ones that have arrived rearranges itself
 * on every poll until the last one lands. Anything the control plane names that
 * the product does not know about is appended, alphabetically so that two polls
 * cannot disagree about the order.
 */
function slots(commitments: Record<string, string>): string[] {
  const extra = Object.keys(commitments)
    .filter((type) => !(type in DOMAIN_META))
    .sort();
  return [...DOMAIN_ORDER, ...extra];
}

function buildNodes(
  commitments: Record<string, string>,
  events: RunEvent[],
  now: number,
): OrbitNode[] {
  const labels = commitmentLabels(events);
  const deadlines = commitmentDeadlines(events);

  const byDomain = new Map<string, RunEvent[]>();
  for (const ev of events) {
    const domain = eventDomain(ev);
    if (!domain) continue;
    const bucket = byDomain.get(domain);
    if (bucket) bucket.push(ev);
    else byDomain.set(domain, [ev]);
  }

  const types = slots(commitments);

  return types.map((type, i) => {
    const meta = DOMAIN_META[type as Domain];
    const label = meta?.label ?? type.replace(/_/g, " ");
    const tracked = type in commitments;
    const status = commitments[type] ?? "";
    const domainEvents = byDomain.get(type) ?? [];
    const deadline = deadlines.get(type as Domain) ?? null;
    const overdue = deadline !== null && now > 0 && deadline < now && status !== "completed";

    const angle = ((-90 + (360 / types.length) * i) * Math.PI) / 180;
    const x = CENTRE + ORBIT_R * Math.cos(angle);
    const y = CENTRE + ORBIT_R * Math.sin(angle);

    const from = {
      x: CENTRE + HUB_R * Math.cos(angle),
      y: CENTRE + HUB_R * Math.sin(angle),
    };
    const to = {
      x: CENTRE + (ORBIT_R - NODE_RING_R - 4) * Math.cos(angle),
      y: CENTRE + (ORBIT_R - NODE_RING_R - 4) * Math.sin(angle),
    };
    const bow = 14;
    const control = {
      x: (from.x + to.x) / 2 + bow * Math.cos(angle + Math.PI / 2),
      y: (from.y + to.y) / 2 + bow * Math.sin(angle + Math.PI / 2),
    };

    const title = labels[type] ?? label;

    return {
      type,
      label,
      title: title.charAt(0).toUpperCase() + title.slice(1),
      icon: meta?.icon ?? "activity",
      variant: meta?.variant ?? "neutral",
      status,
      statusTone: STATUS_TONE[status] ?? meta?.variant ?? "neutral",
      mark: STATUS_MARK[status] ?? (overdue ? "clock" : null),
      stage: stagesReached(domainEvents, status),
      events: domainEvents,
      deadline,
      tracked,
      // An empty slot is not a service that has gone quiet, so it is not drawn
      // as one: it gets its own faint treatment below instead.
      stalled:
        tracked && (status === "blocked" || status === "unresolved" || overdue || status === ""),
      x,
      y,
      spoke: `M ${from.x} ${from.y} Q ${control.x} ${control.y} ${to.x} ${to.y}`,
    };
  });
}

// ─── What happened there ──────────────────────────────────────────────────────

/**
 * The case's own account of the last thing that happened to this service, in
 * the words the control plane wrote at the time.
 *
 * One sentence and no more. The card carrying it is laid over the figure, so
 * every line it grows by is a line of the thing it is annotating that the
 * reader can no longer see — and the feed beside it already holds the rest.
 */
function headlineFor(node: OrbitNode): string {
  for (let i = node.events.length - 1; i >= 0; i--) {
    const message = node.events[i].message;
    if (typeof message === "string" && message) return message;
  }
  return node.tracked
    ? "Nothing has been recorded against this service yet."
    : "This case has asked nothing of this service.";
}

// ─── The card laid over the figure ────────────────────────────────────────────

/** Who it is, where it stands, and what happened. Nothing else fits over a figure. */
function Detail({ node }: { node: OrbitNode }) {
  return (
    <div className={cx(surface.pop, "animate-rise px-4 py-4")}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
        <span
          className={cx(
            "flex size-7 shrink-0 items-center justify-center rounded-control border",
            tone[node.tracked ? node.variant : "neutral"].badge,
          )}
        >
          <Icon name={node.icon} size={15} />
        </span>
        <span className="min-w-0 flex-1 text-[13.5px] font-semibold text-ink">{node.title}</span>
        {isCommitmentStatus(node.status) && <StatusBadge status={node.status} />}
      </div>

      <p className="mt-3 line-clamp-3 text-[13.5px] leading-relaxed text-ink">
        {headlineFor(node)}
      </p>
    </div>
  );
}

// ─── The orbit ────────────────────────────────────────────────────────────────

export const CommitmentOrbit = memo(function CommitmentOrbit({
  commitments,
  events,
  streaming,
}: {
  commitments: Record<string, string>;
  events: RunEvent[];
  /** A round of outreach is in flight, so the service it is working shows it. */
  streaming?: boolean;
}) {
  const now = useNow();
  // Hovering reads; clicking holds, which is the whole of the interaction on a
  // touch screen and the way to reach the panel's own content with a mouse.
  const [hovered, setHovered] = useState<string | null>(null);
  const [held, setHeld] = useState<string | null>(null);

  const nodes = useMemo(() => buildNodes(commitments, events, now), [commitments, events, now]);

  // Hovering wins while the pointer is on a node, so a held service never traps
  // the panel; letting go falls back to whatever was held rather than to nothing.
  const activeType = hovered ?? held;
  const active = nodes.find((n) => n.type === activeType) ?? null;

  useEffect(() => {
    if (!held) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setHeld(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [held]);

  // Which service the run is on right now: the last event that named one.
  const working = useMemo(() => {
    if (!streaming) return null;
    for (let i = events.length - 1; i >= 0; i--) {
      const domain = eventDomain(events[i]);
      if (domain) return domain as string;
    }
    return null;
  }, [events, streaming]);

  // Counted over the commitments the case actually carries, not over the slots
  // in the ring: an empty slot is nothing anyone is waiting on, and counting it
  // as outstanding would leave every case reading as barely started.
  const asked = nodes.filter((n) => n.tracked);
  const closed = asked.filter((n) => isClosed(n.status)).length;
  const total = asked.length;

  return (
    // The figure is the whole of this section's height, and it is square, so the
    // section stands the same height whether or not a service is being read.
    // Nothing below it — the audit trail, anything after — may be pushed down by
    // a hover.
    <section className="@container overflow-hidden rounded-card border border-line bg-gradient-to-b from-surface to-canvas">
      <div className="mx-auto w-full max-w-[520px] px-5 py-5">
        <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div className="min-w-0">
            <p className={type_.label}>What the case is owed</p>
            <p className="mt-1 text-[13.5px] text-ink-soft">
              {total === 0
                ? "Nothing has been asked of a service yet."
                : closed === total
                  ? "Every service has come back."
                  : `${closed} of ${total} closed.`}
            </p>
          </div>
          <p className={cx("hidden items-center gap-1.5 @sm:flex", type_.meta)}>
            <Icon name="eye" size={13} className="shrink-0" />
            Rest on a service to read what happened.
          </p>
        </header>

        {/* The figure is the whole of the body: it is square and it is centred,
            and nothing is reserved beneath it, so the section has no empty half
            when no service is being read. */}
        <div
          className="relative mx-auto mt-3 aspect-square w-full max-w-[420px]"
          onPointerLeave={() => setHovered(null)}
        >
          {/* The light comes from the middle of the figure, so it travels with
                it rather than being aimed at where it happens to sit. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -inset-10"
            style={{
              background:
                "radial-gradient(closest-side, color-mix(in srgb, var(--color-brand) 9%, transparent), transparent)",
            }}
          />
          <svg
            viewBox={`0 0 ${BOX} ${BOX}`}
            className="absolute inset-0 size-full"
            aria-hidden="true"
          >
            {nodes.map((node) => {
              const dim = active !== null && active.type !== node.type;
              return (
                <g
                  key={node.type}
                  className={cx("transition-opacity duration-200", dim && "opacity-35")}
                >
                  {/* An empty slot's line is dotted and colourless: it is the
                      shape of a service that could be asked, not a service
                      that was asked and has not answered. */}
                  <path
                    d={node.spoke}
                    fill="none"
                    strokeWidth={active?.type === node.type ? 2.75 : 1.75}
                    strokeLinecap="round"
                    strokeDasharray={!node.tracked ? "1 7" : node.stalled ? "1 9" : undefined}
                    className={cx(
                      "transition-[stroke-width]",
                      !node.tracked
                        ? "stroke-line-strong"
                        : node.stalled
                          ? tone[node.statusTone].stroke
                          : tone[node.variant].stroke,
                      node.tracked && !node.stalled && "opacity-45",
                    )}
                  />
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={NODE_RING_R}
                    fill="none"
                    strokeWidth={3.5}
                    className="stroke-line"
                  />
                  {/* Only once there is something to draw: a round cap on a
                      zero-length dash paints a dot, which would read as
                      progress on a service nothing has happened to. */}
                  {node.stage > 0 && (
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={NODE_RING_R}
                      fill="none"
                      strokeWidth={3.5}
                      strokeLinecap="round"
                      strokeDasharray={`${(node.stage / STAGES) * NODE_RING_C} ${NODE_RING_C}`}
                      transform={`rotate(-90 ${node.x} ${node.y})`}
                      className={cx(
                        "transition-[stroke-dasharray] duration-500",
                        tone[node.variant].stroke,
                      )}
                    />
                  )}
                </g>
              );
            })}

            <circle
              cx={CENTRE}
              cy={CENTRE}
              r={HUB_RING_R}
              fill="none"
              strokeWidth={4}
              className="stroke-line"
            />
            {closed > 0 && total > 0 && (
              <circle
                cx={CENTRE}
                cy={CENTRE}
                r={HUB_RING_R}
                fill="none"
                strokeWidth={4}
                strokeLinecap="round"
                strokeDasharray={`${(closed / total) * HUB_RING_C} ${HUB_RING_C}`}
                transform={`rotate(-90 ${CENTRE} ${CENTRE})`}
                className="stroke-brand transition-[stroke-dasharray] duration-500"
              />
            )}
          </svg>

          {/* The hub carries the mark, not the tally: the ring around it already
              draws how much of the case is closed, and the line under the
              heading has just said so in words. A number here would be the
              third telling of it, and the weakest — it is the case that sits at
              the centre of the figure, not its score. */}
          <div
            aria-hidden="true"
            className="absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-seal shadow-card"
            style={{ width: pct(HUB_R * 2), height: pct(HUB_R * 2) }}
          >
            <LogoMark variant="light" className="h-[46%] w-auto" />
          </div>

          {nodes.map((node) => {
            const isActive = active?.type === node.type;
            const dim = active !== null && !isActive;
            return (
              <div
                key={node.type}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{
                  left: pct(node.x),
                  top: pct(node.y),
                  width: pct(NODE_R * 2),
                }}
              >
                {working === node.type && (
                  <span
                    aria-hidden="true"
                    className="animate-halo absolute inset-0 rounded-full bg-brand/25"
                  />
                )}
                <button
                  type="button"
                  // The glyph is decorative and the service's name is a sibling
                  // of the control rather than its content, so the name is
                  // stated here — with the state, which is otherwise carried
                  // only by an arc and a colour.
                  aria-label={
                    !node.tracked
                      ? `${node.title}: nothing asked`
                      : node.status
                        ? `${node.title}: ${statusLabel(node.status)}`
                        : node.title
                  }
                  aria-pressed={held === node.type}
                  onPointerEnter={() => setHovered(node.type)}
                  onFocus={() => setHovered(node.type)}
                  onBlur={() => setHovered((current) => (current === node.type ? null : current))}
                  onClick={() => setHeld((current) => (current === node.type ? null : node.type))}
                  className={cx(
                    "relative flex aspect-square w-full items-center justify-center rounded-full border bg-surface transition-[transform,box-shadow,opacity] duration-200",
                    isActive ? "scale-110 shadow-pop" : "shadow-card",
                    dim && "opacity-45",
                    held === node.type ? tone[node.variant].border : "border-line",
                    !node.tracked && "border-dashed bg-surface-muted shadow-none",
                  )}
                >
                  <Icon
                    name={node.icon}
                    size={21}
                    className={cx(
                      "shrink-0",
                      node.tracked ? tone[node.variant].text : "text-ink-muted",
                    )}
                  />
                  {node.mark && (
                    <span
                      className={cx(
                        "absolute -right-0.5 -bottom-0.5 flex size-[19px] items-center justify-center rounded-full border bg-surface",
                        tone[node.statusTone].badge,
                      )}
                    >
                      <Icon name={node.mark} size={11} />
                    </span>
                  )}
                </button>
                <span
                  className={cx(
                    "absolute top-full left-1/2 mt-2 -translate-x-1/2 whitespace-nowrap text-[11.5px] font-medium transition-opacity duration-200",
                    dim
                      ? "text-ink-muted opacity-45"
                      : node.tracked
                        ? "text-ink"
                        : "text-ink-muted",
                  )}
                >
                  {node.label}
                </span>
              </div>
            );
          })}
          {/* Out of the flow entirely, so no service can lengthen this section
              and push the audit trail down the page. It settles at the foot of
              the figure, and moves to the head of it for the services that live
              down there — a card that covers the node it is describing is worse
              than one that has moved.

              The live region is this wrapper rather than the card, because a
              keyed child is replaced rather than changed, and a region that is
              itself replaced announces nothing. */}
          <div
            aria-live="polite"
            className={cx(
              "pointer-events-none absolute inset-x-0 z-10",
              active && active.y > CENTRE ? "top-0" : "bottom-0",
            )}
          >
            {active && (
              // Takes the pointer back, so crossing the card does not fall
              // through to a node beneath it and swap the card out mid-read.
              <div className="pointer-events-auto">
                <Detail key={active.type} node={active} />
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
});
