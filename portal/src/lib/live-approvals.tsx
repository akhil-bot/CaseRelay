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

/** The facts a supervisor needs about a case, read off the case detail once. */
function describe(detail: LiveCaseDetail | null): Partial<Gate> {
  if (!detail) return {};
  const record = detail.case;
  const packet = fields(record.referral_packet);
  const referrals = Array.isArray(packet.referrals) ? packet.referrals : [];

  return {
    advocateName: text(record.volunteer_name) || text(packet.volunteer_name) || undefined,
    commitmentCount: Object.keys(detail.commitments).length,
    grantCount: detail.grants.length,
    organisations: referrals
      .map((entry) => {
        const referral = fields(entry);
        return text(referral.target_org_short) || text(referral.target_org);
      })
      .filter((name) => name.length > 0),
    openedAt: text(record.created_at) || undefined,
  };
}

async function collectGates(): Promise<Gate[]> {
  const [approvals, cases] = await Promise.all([listPendingApprovals(), listCases()]);

  const listed = new Map<string, CaseListItem>();
  for (const record of cases) {
    const caseId = text(record.case_id);
    if (caseId) listed.set(caseId, record);
  }

  const drafts = cases.filter((record) => text(record.status) === "draft");

  // A gate is worth several facts the list does not carry — how many commitments
  // were extracted, which organisations approval would contact — so each gated
  // case is read in full. Once, even where it holds both kinds of gate, and only
  // while it is waiting: there are never many at a time.
  const gatedIds = new Set<string>();
  for (const record of drafts) {
    const caseId = text(record.case_id);
    if (caseId) gatedIds.add(caseId);
  }
  for (const approval of approvals) gatedIds.add(String(approval.case_id));

  const details = new Map<string, LiveCaseDetail | null>(
    await Promise.all(
      [...gatedIds].map(
        async (caseId): Promise<[string, LiveCaseDetail | null]> => [
          caseId,
          await getCase(caseId).catch(() => null),
        ],
      ),
    ),
  );

  function childName(caseId: string, detail: LiveCaseDetail | null): string {
    return (
      text(detail?.case.child_name) || text(listed.get(caseId)?.child_name) || caseId
    );
  }

  /** The list carries the advocate too, so a case that would not open still names one. */
  function advocate(caseId: string): string | undefined {
    return text(listed.get(caseId)?.volunteer_name) || undefined;
  }

  const escalations: Gate[] = approvals.map((approval) => {
    const caseId = String(approval.case_id);
    const detail = details.get(caseId) ?? null;
    const facts = describe(detail);
    return {
      ...facts,
      key: `escalation:${approval.approval_id}`,
      kind: "escalation" as GateKind,
      caseId,
      childName: childName(caseId, detail),
      advocateName: facts.advocateName ?? advocate(caseId),
      approvalId: String(approval.approval_id),
      reason: typeof approval.reason === "string" ? approval.reason : undefined,
      actionType: typeof approval.action_type === "string" ? approval.action_type : undefined,
    };
  });

  // A draft with nothing extracted yet has nothing to approve, so it is not a
  // gate — which is why the status alone was never enough to build this from.
  const activations = drafts
    .map((record): Gate | null => {
      const caseId = text(record.case_id);
      if (!caseId) return null;
      const detail = details.get(caseId) ?? null;
      if (!detail || Object.keys(detail.commitments).length === 0) return null;
      const facts = describe(detail);
      return {
        ...facts,
        key: `activation:${caseId}`,
        kind: "activation" as GateKind,
        caseId,
        childName: childName(caseId, detail),
        advocateName: facts.advocateName ?? advocate(caseId),
      };
    })
    .filter((gate): gate is Gate => gate !== null);

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
}

const LiveApprovalsContext = createContext<LiveApprovalsValue | null>(null);

const POLL_INTERVAL = 15_000;

export function LiveApprovalsProvider({ children }: { children: ReactNode }) {
  const [gates, setGates] = useState<Gate[]>([]);
  const [decidingKey, setDecidingKey] = useState<string | null>(null);
  const [decideError, setDecideError] = useState<{ key: string; message: string } | null>(null);
  const reloadRef = useRef<() => void>(() => {});

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

  const value = useMemo<LiveApprovalsValue>(
    () => ({ gates, decidingKey, decideError, decide, refresh }),
    [gates, decidingKey, decideError, decide, refresh],
  );

  return <LiveApprovalsContext.Provider value={value}>{children}</LiveApprovalsContext.Provider>;
}

export function useLiveApprovals() {
  const context = useContext(LiveApprovalsContext);
  if (!context) throw new Error("useLiveApprovals must be used inside LiveApprovalsProvider");
  return context;
}
