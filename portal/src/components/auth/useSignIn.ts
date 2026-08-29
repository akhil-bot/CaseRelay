"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ROLE_HOME, type Role } from "@/design/personas";
import { storeRole } from "@/lib/role";

export type SignInPhase = "idle" | "signing" | "done";

const SIGNING_MS = 750;
const SETTLE_MS = 420;

/**
 * There is no auth backend behind this prototype. Signing in navigates to the
 * app after a brief pending-then-settled sequence, because a sign-in that
 * resolves in one frame reads as a broken button.
 *
 * The role is written before navigating, not after: the sidebar is settled from
 * <html> as the next page is parsed, so it has to already be there or the app
 * paints the previous role's navigation for a frame.
 *
 * `action` names which submit control started it, so a form with two ways in
 * only animates the one that was actually pressed.
 */
export function useSignIn(role: Role) {
  const router = useRouter();
  const [phase, setPhase] = useState<SignInPhase>("idle");
  const [action, setAction] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (phase !== "idle") return;

    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    setAction(submitter?.value || "primary");
    setPhase("signing");

    timers.current.push(
      setTimeout(() => setPhase("done"), SIGNING_MS),
      setTimeout(() => {
        storeRole(role);
        router.push(ROLE_HOME[role]);
      }, SIGNING_MS + SETTLE_MS),
    );
  }

  return { phase, action, signIn };
}
