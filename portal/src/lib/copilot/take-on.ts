"use client";

import { useCallback } from "react";
import { createCase, listScenarios } from "@/lib/api";
import { useToolEvents } from "@/lib/copilot/tool-events";
import { useViewer } from "@/lib/viewer";

export interface CaseTakenOn {
  caseId: string;
  childName: string;
  /** ISO-8601. When the work on this case is due. */
  dueAt: string;
}

/**
 * No child of that name is waiting.
 *
 * Carries who *is* waiting, because the two callers say so differently: the
 * assistant needs the names in a sentence it can read back, and the picker
 * already has them on screen and needs only to say the choice did not land.
 */
export class UnknownChild extends Error {
  constructor(
    readonly asked: string,
    readonly waiting: string[],
  ) {
    super(`No child named "${asked}" is waiting for an advocate.`);
    this.name = "UnknownChild";
  }
}

/**
 * Take on a child's case, from a first name.
 *
 * Shared for the same reason `useBeginOutreach` is. A case can be taken on two
 * ways — by asking the assistant, or by picking the child off the list it draws
 * — and the two have to be the same act: the same scenario matched, the same
 * entry pushed into the session registry, the same subscribers told. The Data
 * Lab's live view is wired to `onCaseCreated`, so a second implementation that
 * forgot to fire it would create a case the rest of the app never heard about.
 *
 * The scenario list is fetched once and kept on the shared ref, so picking a
 * child off a list that has just been drawn costs no further request.
 */
export function useTakeOnCase(): (child: string, dueIn?: string) => Promise<CaseTakenOn> {
  const { pushCase, scenarioCacheRef, subscribersRef } = useToolEvents();
  const { profile } = useViewer();

  return useCallback(
    async (child: string, dueIn?: string) => {
      if (!scenarioCacheRef.current) {
        scenarioCacheRef.current = await listScenarios();
      }
      const waiting = scenarioCacheRef.current;

      const match =
        waiting.find((s) => s.id === child) ||
        waiting.find((s) => s.child_name.toLowerCase() === child.toLowerCase());
      if (!match) {
        throw new UnknownChild(
          child,
          waiting.map((s) => s.child_name),
        );
      }

      const created = await createCase(match.id, dueIn, profile.volunteerId, profile.name);
      pushCase({
        caseId: created.case_id,
        scenario: match.id,
        childName: match.child_name,
      });
      for (const callback of subscribersRef.current ?? []) callback.onCaseCreated(created, match);

      return { caseId: created.case_id, childName: match.child_name, dueAt: created.due_at };
    },
    [pushCase, scenarioCacheRef, subscribersRef, profile],
  );
}
