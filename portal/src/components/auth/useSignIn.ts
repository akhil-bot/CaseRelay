"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Persona } from "@/design/personas";
import { useViewer } from "@/lib/viewer";

export type SignInPhase = "idle" | "signing" | "done";

/** Long enough to read as work being done, short enough not to feel like waiting. */
const SIGNING_MS = 750;
const SETTLE_MS = 420;

/**
 * There is no auth backend behind this prototype. Signing in selects the matching
 * view and enters the app — but it still runs through a real pending-then-settled
 * sequence, because a sign-in that resolves in one frame reads as a broken button.
 *
 * `action` names which submit control started it, so a form with two ways in only
 * animates the one that was actually pressed.
 */
export function useSignIn(persona: Persona) {
  const router = useRouter();
  const { setPersona } = useViewer();
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
        setPersona(persona);
        router.push("/");
      }, SIGNING_MS + SETTLE_MS),
    );
  }

  return { phase, action, signIn };
}
