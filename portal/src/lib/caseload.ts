import type { IconName } from "@/components/icons";
import type { PersonaProfile } from "@/design/personas";
import type { Tone } from "@/design/tokens";

/**
 * What the product says about a case appearing in a list, in one place.
 *
 * Two surfaces show an advocate their caseload — the My Cases screen and the
 * assistant, when asked what they are working on — and they have to agree. Not
 * only on wording: if the two disagree about *which* cases are the advocate's,
 * the chat becomes a way to see a case the screen deliberately withheld. So the
 * ownership rule lives here rather than being written out at each call site.
 */

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function fields(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/** Whose a case is. The only part of a case the ownership rule reads. */
export interface CaseOwner {
  /** Empty on a case whose packet never named an advocate. */
  advocateId: string;
  advocateName: string;
}

/** A case as any list of cases needs it. Named apart from `CaseSummary` in derive.ts,
 *  which is the demo timeline's own shape and unrelated. */
export interface CaseBrief extends CaseOwner {
  caseId: string;
  /** Empty until intake names the child. A list says so rather than showing a dash. */
  childName: string;
  status: string;
}

/**
 * The fields every list needs, read defensively.
 *
 * `/v1/cases` answers with an open record and the two code paths behind it do not
 * agree on the keys: the in-memory one carries a handful of fields, the stored
 * one the whole case document with the referral packet nested inside. Both are
 * tried here so no caller has to know which it got.
 */
export function summarise(raw: Record<string, unknown>): CaseBrief {
  const packet = fields(raw.referral_packet);
  return {
    caseId: text(raw.case_id) || text(packet.case_id),
    childName: text(raw.child_name) || text(fields(packet.child).name),
    status: text(raw.status) || "unknown",
    advocateId: text(raw.volunteer_id) || text(packet.volunteer_id),
    advocateName: text(raw.volunteer_name) || text(packet.volunteer_name),
  };
}

/**
 * Whether a case is the viewer's own.
 *
 * `GET /v1/cases` takes no volunteer filter and answers with the whole system,
 * so "mine" is decided here. A case that names no advocate at all is kept: it
 * cannot be shown to belong to someone else, and dropping it would hide a case
 * from the only person who might chase it.
 *
 * A role with no `volunteerId` — supervisor, admin — owns everything. That is
 * not an oversight: the whole team's caseload is the point of those views.
 */
export function ownedBy(item: CaseOwner, profile: PersonaProfile): boolean {
  const mine = profile.volunteerId;
  if (!mine) return true;
  return (
    (!item.advocateId && !item.advocateName) ||
    item.advocateId === mine ||
    item.advocateName === profile.name
  );
}

/**
 * What each case status is called, and how loudly.
 *
 * `quiet` is the difference between a badge and a dot: a case that is simply
 * running is the norm across a caseload, and a badge every row carries is a
 * badge that says nothing. Only the states that are not "running normally" —
 * one waiting on a supervisor, one already finished — are worth the ink.
 */
export const STATUS_META: Record<
  string,
  { label: string; variant: Tone; icon: IconName; quiet?: boolean }
> = {
  draft: { label: "Awaiting activation", variant: "warn", icon: "clock" },
  active: { label: "Starting up", variant: "brand", icon: "activity", quiet: true },
  monitoring: { label: "CaseRelay is watching", variant: "brand", icon: "activity", quiet: true },
  closed: { label: "Completed", variant: "seal", icon: "checkCircle" },
};

export function statusMeta(status: string) {
  return (
    STATUS_META[status] ?? {
      label: status.replace(/_/g, " "),
      variant: "neutral" as Tone,
      icon: "activity" as IconName,
      quiet: true,
    }
  );
}
