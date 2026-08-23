"use client";

import { Icon, type IconName } from "@/components/icons";
import type { SignInPhase } from "@/components/auth/useSignIn";
import { auth, cx } from "@/design/tokens";

/** A ring that never completes, so it reads as work in progress rather than progress. */
export function Spinner({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className="animate-spin"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.6" opacity="0.25" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * The submit control carries the whole state of the attempt: idle, working, then
 * settled. It keeps its width while doing so, so the form never jumps under the
 * cursor mid-press.
 */
export function SubmitButton({
  phase,
  action,
  value = "primary",
  label,
  pendingLabel,
  doneLabel = "Signed in",
  icon,
  className,
}: {
  phase: SignInPhase;
  action: string | null;
  value?: string;
  label: string;
  pendingLabel: string;
  doneLabel?: string;
  icon?: IconName;
  className?: string;
}) {
  const busy = phase !== "idle";
  const mine = busy && action === value;

  return (
    <button
      type="submit"
      value={value}
      disabled={busy}
      aria-busy={mine}
      className={cx(className, busy && !mine && "opacity-40")}
    >
      {!mine && (
        <>
          {icon && <Icon name={icon} size={15} />}
          {label}
          {!icon && <Icon name="arrowRight" size={15} />}
        </>
      )}
      {mine && phase === "signing" && (
        <>
          <Spinner />
          {pendingLabel}
        </>
      )}
      {mine && phase === "done" && (
        <>
          <span className="animate-pop">
            <Icon name="check" size={15} strokeWidth={2.6} />
          </span>
          {doneLabel}
        </>
      )}
    </button>
  );
}

/** A hairline at the top of the viewport that fills while the attempt is in flight. */
export function SignInProgress({ phase }: { phase: SignInPhase }) {
  if (phase === "idle") return null;

  return (
    <div className={auth.progressTrack} role="presentation">
      <span className={cx(auth.progressBar, phase === "done" ? "auth-fill-done" : "auth-fill")} />
    </div>
  );
}
