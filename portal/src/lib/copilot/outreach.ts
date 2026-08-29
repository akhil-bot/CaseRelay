"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback } from "react";
import { submitRun } from "@/lib/api";
import { useToolEvents } from "@/lib/copilot/tool-events";

/**
 * Long enough for the assistant's acknowledgement to start streaming before the
 * route changes under it. A navigation that lands first reads as the chat having
 * ignored the click.
 */
const NAVIGATE_DELAY_MS = 1500;

export interface OutreachStarted {
  runId: string;
  caseId: string;
  livePath: string;
}

/**
 * Start a round of outreach and take the person to where they can watch it.
 *
 * Shared deliberately. Outreach can be triggered two ways — by asking the
 * assistant, or by pressing the button on the case card it draws — and the two
 * have to be the same act: same run, same subscribers notified, same navigation.
 * When this logic lived inside the tool handler, the button could only have been
 * a second implementation of it, and the first thing to drift would have been
 * the Data Lab's live event stream, which starts only when `onRunStarted` fires.
 */
export function useBeginOutreach(): (caseId: string) => Promise<OutreachStarted> {
  const router = useRouter();
  const pathname = usePathname();
  const { subscribersRef } = useToolEvents();

  return useCallback(
    async (caseId: string) => {
      const ref = await submitRun(caseId);
      for (const callback of subscribersRef.current ?? []) callback.onRunStarted(ref, caseId);

      const livePath = `/cases/${caseId}`;
      if (pathname !== livePath) {
        setTimeout(() => router.push(livePath), NAVIGATE_DELAY_MS);
      }

      return { runId: ref.run_id, caseId, livePath };
    },
    [router, pathname, subscribersRef],
  );
}
