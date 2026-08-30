"use client";

/**
 * ── Everything on the control plane that is waiting on a person ──────────────
 *
 * Two different things stop a case, and until now neither could be seen without
 * opening the exact case it belonged to:
 *
 *   activation — a case sitting in draft with its commitments extracted and its
 *                grants proposed. Not an approval record; a case status.
 *   escalation — a quarantined action recorded under the case's approvals.
 *
 * Both are gathered here so the approvals queue can show them side by side, and
 * both are gathered *once*: the sidebar badge, the queue and the case detail all
 * read this one poll rather than each running their own.
 *
 * Who decides is not settled here. The API records whoever the caller names, and
 * for now that is the signed-in advocate — see `decide`.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  activateCase,
  decideApproval,
  getCase,
  listCases,
  listPendingApprovals,
  type CaseListItem,
  type LiveCaseDetail,
} from "@/lib/api";

export type GateKind = "activation" | "escalation";

export interface Gate {
  /** Stable across polls, so a card is not remounted while it is being decided. */
  key: string;
  kind: GateKind;
  caseId: string;
  childName: string;
  /** Escalations are approval records. Activation is not one, and has no id. */
  approvalId?: string;
  reason?: string;
  /**
   * Whose case this is — the supervisor's first question about any gate, and the
   * one thing a queue of case ids cannot answer.
   */
  advocateName?: string;
  /** What approving actually covers, counted off the case itself. */
  commitmentCount?: number;
  grantCount?: number;
  /** The organisations approval would begin contacting, named. */
  organisations?: string[];
  /** ISO-8601. How long the case has been standing here. */
  openedAt?: string;
  /** Which quarantined action is being held, for an escalation. */
  actionType?: string;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function fields(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * The facts that only the case aggregate carries.
 *
 * Everything else a gate card shows is on the caseload listing already. These
 * two are not, and they are the reason a case is opened at all — so they are
 * read when a supervisor asks for them, not on a timer.
 */
function describe(detail: LiveCaseDetail): Partial<Gate> {
  const record = detail.case;
  const packet = fields(record.referral_packet);
  const referrals = Array.isArray(packet.referrals) ? packet.referrals : [];

  return {
    commitmentCount: Object.keys(detail.commitments).length,
    grantCount: detail.grants.length,
    organisations: referrals
      .map((entry) => {
        const referral = fields(entry);
        return text(referral.target_org_short) || text(referral.target_org);
      })
      .filter((name) => name.length > 0),
  };
}

/**
 * Drafts the control plane could not classify, and what opening them found.
 *
 * A draft is a gate once something has been extracted from it, and the caseload
 * listing normally says so outright in `commitment_count`. Where it does not —
 * a case stored before that field existed — the only way to know is to open the
 * case, so this remembers the answer rather than asking again every fifteen
 * seconds. Reading the case also repairs the stored count, so a case lands here
 * at most once and the listing answers for it from then on.
 */
const classified = new Map<string, number>();

async function commitmentsOn(caseId: string, record: CaseListItem): Promise<number | null> {
  if (typeof record.commitment_count === "number") return record.commitment_count;

  const known = classified.get(caseId);
  if (known !== undefined) return known;

  const detail = await getCase(caseId).catch(() => null);
  // A read that failed is not an answer. Say so, rather than recording a zero
  // that would drop a real gate off the queue until the tab is reloaded.
  if (!detail) return null;

  const counted = Object.keys(detail.commitments).length;
  classified.set(caseId, counted);
  return counted;
}

async function collectGates(): Promise<Gate[]> {
  // Only drafts, rather than the whole system filtered down here. Escalations
  // arrive already narrowed — `/v1/approvals` returns the pending ones — so
  // between them these two calls describe everything that could be waiting.
  const [approvals, drafts] = await Promise.all([
    listPendingApprovals(),
    listCases({ status: "draft" }),
  ]);

  // Belt and braces: a control plane that does not know the `status` filter
  // answers with every case rather than refusing, and every active case would
  // then be read as a draft awaiting activation.
  const draftRows = drafts.items.filter((record) => text(record.status) === "draft");

  const escalations: Gate[] = approvals.map((approval) => {
    const caseId = String(approval.case_id);
    return {
      key: `escalation:${approval.approval_id}`,
      kind: "escalation" as GateKind,
      caseId,
      childName: text(approval.child_name) || caseId,
      approvalId: String(approval.approval_id),
      reason: typeof approval.reason === "string" ? approval.reason : undefined,
      actionType: typeof approval.action_type === "string" ? approval.action_type : undefined,
    };
  });

  // A draft with nothing extracted yet has nothing to approve, so it is not a
  // gate — which is why the status alone was never enough to build this from.
  const activations = (
    await Promise.all(
      draftRows.map(async (record): Promise<Gate | null> => {
        const caseId = text(record.case_id);
        if (!caseId) return null;

        const commitments = await commitmentsOn(caseId, record);
        if (commitments === null || commitments === 0) return null;

        return {
          key: `activation:${caseId}`,
          kind: "activation" as GateKind,
          caseId,
          childName: text(record.child_name) || caseId,
          advocateName: text(record.volunteer_name) || undefined,
          commitmentCount: commitments,
          openedAt: text(record.created_at) || undefined,
        };
      }),
    )
  ).filter((gate): gate is Gate => gate !== null);

  // Cases that are no longer drafts have been decided, so what was learned by
  // opening them is spent. Kept against the drafts this poll saw rather than
  // against the gates it returned, because a draft found to have nothing
  // extracted is exactly the one worth remembering: it is the one that would
  // otherwise be opened again every fifteen seconds to learn the same thing.
  const stillDraft = new Set(draftRows.map((record) => text(record.case_id)));
  for (const caseId of classified.keys()) {
    if (!stillDraft.has(caseId)) classified.delete(caseId);
  }

  // Activation first: it is the gate that grants access to the child's data at
  // all, so it outranks anything held up behind one.
  return [...activations, ...escalations];
}

/**
 * Whether a poll learned anything, compared on what the cards actually render.
 *
 * Everything a card shows has to be in here, or a card can hold a stale figure
 * for as long as the queue's shape happens not to change.
 */
function rendered(gate: Gate): string {
  return [
    gate.key,
    gate.childName,
    gate.advocateName,
    gate.reason,
    gate.actionType,
    gate.commitmentCount,
    gate.grantCount,
    gate.openedAt,
    gate.organisations?.join(","),
  ].join("|");
}

function unchanged(before: Gate[], after: Gate[]): boolean {
  return (
    before.length === after.length &&
    before.every((gate, i) => rendered(gate) === rendered(after[i]))
  );
}

interface LiveApprovalsValue {
  gates: Gate[];
  /** The one gate being decided, so only its own buttons go quiet. */
  decidingKey: string | null;
  decideError: { key: string; message: string } | null;
  decide: (gate: Gate, decision: "approve" | "reject", decidedBy: string) => Promise<void>;
  refresh: () => void;
  /**
   * Open the case behind a gate, for the facts the caseload listing cannot
   * carry: how many grants are proposed, and which organisations approving
   * would begin contacting. Nothing reads a case until this is called, and
   * calling it twice for the same case reads it once.
   */
  open: (caseId: string) => void;
  /** Cases being read right now, so the card that asked can say it is working. */
  opening: ReadonlySet<string>;
}

const LiveApprovalsContext = createContext<LiveApprovalsValue | null>(null);

const POLL_INTERVAL = 15_000;

const NONE: ReadonlySet<string> = new Set();

export function LiveApprovalsProvider({ children }: { children: ReactNode }) {
  const [gates, setGates] = useState<Gate[]>([]);
  const [decidingKey, setDecidingKey] = useState<string | null>(null);
  const [decideError, setDecideError] = useState<{ key: string; message: string } | null>(null);
  const reloadRef = useRef<() => void>(() => {});

  // What opening a case turned up, by case id, kept so that a card a supervisor
  // has already expanded does not collapse back to a summary on the next poll.
  const [opened, setOpened] = useState<Record<string, Partial<Gate>>>({});
  const [opening, setOpening] = useState<ReadonlySet<string>>(NONE);
  const askedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // A poll, a decision and a returning tab can all ask at once. Only the most
    // recent answer is allowed to land.
    let latest = 0;

    const schedule = () => {
      if (timer !== null) clearTimeout(timer);
      timer = cancelled ? null : setTimeout(tick, POLL_INTERVAL);
    };

    const load = async () => {
      const attempt = ++latest;
      try {
        const next = await collectGates();
        if (cancelled || attempt !== latest) return;
        setGates((prev) => (unchanged(prev, next) ? prev : next));
      } catch {
        // The portal runs with or without a control plane behind it. Where there
        // is none there are no live gates, which is not a failure worth putting
        // on screen and must not disturb the scripted walkthrough. Whatever was
        // last seen stays until a later poll succeeds.
      } finally {
        if (!cancelled && attempt === latest) schedule();
      }
    };

    const tick = () => {
      // A backgrounded tab is watching nothing. Wait for it to come back rather
      // than spending two requests on nobody.
      if (document.hidden) {
        schedule();
        return;
      }
      void load();
    };

    const onVisibilityChange = () => {
      if (!document.hidden) void load();
    };

    reloadRef.current = () => void load();
    void load();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      reloadRef.current = () => {};
    };
  }, []);

  const decide = useCallback(
    async (gate: Gate, decision: "approve" | "reject", decidedBy: string) => {
      setDecidingKey(gate.key);
      setDecideError(null);
      try {
        if (gate.kind === "activation") {
          await activateCase(gate.caseId, decidedBy);
        } else if (gate.approvalId) {
          await decideApproval(gate.approvalId, decision, decidedBy);
        }
        // Drop it now rather than at the next poll. Someone has just decided;
        // the card must not sit there looking undecided for another fifteen
        // seconds, and the badge must not keep counting it.
        setGates((prev) => prev.filter((item) => item.key !== gate.key));
        reloadRef.current();
      } catch (err: unknown) {
        setDecideError({
          key: gate.key,
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setDecidingKey(null);
      }
    },
    [],
  );

  const refresh = useCallback(() => reloadRef.current(), []);

  const open = useCallback((caseId: string) => {
    // Asked for once per case. A second click while the first read is still out
    // would be coalesced by the API client anyway, but a case already read is
    // not worth going back for at all.
    if (!caseId || askedRef.current.has(caseId)) return;
    askedRef.current.add(caseId);

    setOpening((prev) => new Set(prev).add(caseId));

    void getCase(caseId)
      .then((detail) => {
        setOpened((prev) => ({ ...prev, [caseId]: describe(detail) }));
      })
      .catch(() => {
        // Let it be asked for again. A card that failed to expand should
        // respond to a second click rather than sitting there inert.
        askedRef.current.delete(caseId);
      })
      .finally(() => {
        setOpening((prev) => {
          const next = new Set(prev);
          next.delete(caseId);
          return next.size === 0 ? NONE : next;
        });
      });
  }, []);

  // What the poll knows, with anything a supervisor has opened laid over it.
  const seen = useMemo(
    () => gates.map((gate) => (opened[gate.caseId] ? { ...gate, ...opened[gate.caseId] } : gate)),
    [gates, opened],
  );

  const value = useMemo<LiveApprovalsValue>(
    () => ({ gates: seen, decidingKey, decideError, decide, refresh, open, opening }),
    [seen, decidingKey, decideError, decide, refresh, open, opening],
  );

  return <LiveApprovalsContext.Provider value={value}>{children}</LiveApprovalsContext.Provider>;
}

export function useLiveApprovals() {
  const context = useContext(LiveApprovalsContext);
  if (!context) throw new Error("useLiveApprovals must be used inside LiveApprovalsProvider");
  return context;
}
