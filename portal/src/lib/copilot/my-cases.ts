"use client";

import { useCallback } from "react";
import { CASE_PAGE, listCases } from "@/lib/api";
import { ownedBy, summarise, type CaseBrief } from "@/lib/caseload";
import { useViewer } from "@/lib/viewer";

/**
 * A ceiling on how much of the caseload one question will read.
 *
 * The control plane pages at twenty and answers with a total, so "all of them"
 * is a loop. A loop over a number the server chose needs a stop of its own —
 * this is not a page size, it is the point at which the assistant stops walking
 * and answers with what it has.
 */
const MAX_PAGES = 25;

/**
 * The signed-in advocate's own cases, newest first.
 *
 * The assistant is asked "what am I working on" and has to answer from the same
 * caseload the My Cases screen shows, narrowed the same way. `/v1/cases` takes
 * no volunteer filter — it answers with the whole system — so the narrowing is
 * `ownedBy`, shared with that screen precisely so the chat cannot become a way
 * to read a case the screen withheld.
 *
 * Every page is fetched rather than just the first, because "how many do I have"
 * is a question about the whole list and a truncated answer to it is a wrong
 * answer, not a partial one. Identical requests in flight are already coalesced
 * in `lib/api.ts`, so asking twice in one turn costs one round trip.
 */
export function useMyCases(): () => Promise<CaseBrief[]> {
  const { profile } = useViewer();

  return useCallback(async () => {
    const first = await listCases({ limit: CASE_PAGE });
    const raw = [...first.items];

    for (let page = 1; page < MAX_PAGES && raw.length < first.total; page += 1) {
      const next = await listCases({ offset: raw.length, limit: CASE_PAGE });
      // A page that comes back empty means the list ended sooner than `total`
      // claimed. Trusting the count over the data would loop to the ceiling.
      if (next.items.length === 0) break;
      raw.push(...next.items);
    }

    return raw.map(summarise).filter((item) => ownedBy(item, profile));
  }, [profile]);
}
