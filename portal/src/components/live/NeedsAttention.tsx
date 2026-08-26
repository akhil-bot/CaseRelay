"use client";

import { memo } from "react";
import { Icon, type IconName } from "@/components/icons";
import { Card, DOMAIN_META, Rows, cx } from "@/components/ui/primitives";
import { row, tone, type Tone } from "@/design/tokens";
import type { RunEvent } from "@/lib/api";
import {
  commitmentDeadlines,
  commitmentLabels,
  commitmentTitle,
  formatFollowUp,
  useNow,
} from "@/lib/case-events";
import type { Domain } from "@/lib/types";

interface AttentionItem {
  domain: Domain | null;
  title: string;
  body: string;
  icon: IconName;
  variant: Extract<Tone, "danger" | "warn">;
}

/**
 * Is a held reply still sitting with the supervisor?
 *
 * The quarantine phase holds a reply; the approval phase releases it. Only the
 * ordering of the two tells you whether a decision is still outstanding, so a
 * later approval cancels an earlier hold rather than adding to it.
 */
function replyAwaitingSupervisor(events: RunEvent[]): boolean {
  let held = -1;
  let released = -1;
  events.forEach((ev, i) => {
    if (ev.event !== "phase_complete" && ev.event !== "phase_error") return;
    const phase = ev.phase ?? "";
    if (phase.includes("quarantine")) held = i;
    if (phase.includes("approve")) released = i;
  });
  return held > -1 && released < held;
}

function unansweredDomains(events: RunEvent[]): Set<string> {
  const domains = new Set<string>();
  for (const ev of events) {
    if (ev.event !== "supervisor_notified") continue;
    if (typeof ev.commitment_type === "string") domains.add(ev.commitment_type);
  }
  return domains;
}

/**
 * Everything on this case that is waiting on a person, worst first.
 *
 * Each entry is a commitment that cannot move on its own: held for review,
 * refused by the provider, sitting with the supervisor, or past a date that has
 * come and gone. A commitment the providers are still working through is not
 * here — it does not need anybody yet.
 */
function attentionItems(
  commitments: Record<string, string>,
  events: RunEvent[],
  now: number,
): AttentionItem[] {
  const labels = commitmentLabels(events);
  const deadlines = commitmentDeadlines(events);
  const awaitingSupervisor = replyAwaitingSupervisor(events);
  const unanswered = unansweredDomains(events);

  const items: AttentionItem[] = [];
  const claimed = new Set<string>();
  let anyBlocked = false;

  for (const [type, status] of Object.entries(commitments)) {
    if (!(type in DOMAIN_META)) continue;
    const domain = type as Domain;
    if (status !== "blocked" && status !== "unresolved") continue;
    claimed.add(type);
    anyBlocked ||= status === "blocked";
    items.push({
      domain,
      title: commitmentTitle(domain, labels),
      icon: DOMAIN_META[domain].icon,
      variant: status === "blocked" ? "danger" : "warn",
      body:
        status === "blocked"
          ? awaitingSupervisor
            ? "Your supervisor has the reply. Nothing was sent on, and nothing moves here until they decide."
            : "The reply was held back, so this has not moved."
          : "The provider could not sort this out. It needs someone to pick it up.",
    });
  }

  // A held reply usually leaves a blocked commitment behind, and the two are one
  // episode. It only earns a line of its own when no commitment carries it.
  if (awaitingSupervisor && !anyBlocked) {
    items.push({
      domain: null,
      title: "A reply is with your supervisor",
      icon: "shield",
      variant: "danger",
      body: "It was held before anyone acted on it. Nothing moves until they decide.",
    });
  }

  for (const type of unanswered) {
    if (claimed.has(type) || !(type in DOMAIN_META)) continue;
    if (commitments[type] === "completed") continue;
    claimed.add(type);
    const domain = type as Domain;
    items.push({
      domain,
      title: commitmentTitle(domain, labels),
      icon: DOMAIN_META[domain].icon,
      variant: "warn",
      body: "Nobody answered. Your supervisor has been told.",
    });
  }

  for (const [domain, deadline] of deadlines) {
    if (claimed.has(domain)) continue;
    if (commitments[domain] === "completed" || deadline > now) continue;
    claimed.add(domain);
    items.push({
      domain,
      title: commitmentTitle(domain, labels),
      icon: DOMAIN_META[domain].icon,
      variant: "warn",
      body: `Its date passed ${formatFollowUp(deadline)} and nobody has answered.`,
    });
  }

  return items.sort((a, b) => (a.variant === b.variant ? 0 : a.variant === "danger" ? -1 : 1));
}

export const NeedsAttention = memo(function NeedsAttention({
  commitments,
  events,
}: {
  commitments: Record<string, string>;
  events: RunEvent[];
}) {
  const now = useNow();
  const items = attentionItems(commitments, events, now);

  // Nothing to do is a fact worth one quiet line. Dressed up as a card with a
  // reassuring illustration, it would be the thing people learn to scroll past.
  if (items.length === 0) {
    return (
      <p className="flex items-center gap-2 rounded-card border border-line bg-surface px-4 py-2.5 text-[12.5px] text-ink-muted">
        <Icon name="check" size={14} className="shrink-0" />
        Nothing on this case needs a person right now.
      </p>
    );
  }

  return (
    <Card icon="alert" title="Needs a person" flush>
      <Rows as="ol">
        {items.map((item) => (
          <li
            key={`${item.variant}-${item.domain ?? item.title}`}
            className={cx("flex items-start gap-3 border-l-2", row.pad, tone[item.variant].border)}
          >
            <Icon
              name={item.icon}
              size={16}
              className={cx("mt-0.5 shrink-0", tone[item.variant].text)}
            />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-ink">{item.title}</p>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-soft">{item.body}</p>
            </div>
          </li>
        ))}
      </Rows>
    </Card>
  );
});
