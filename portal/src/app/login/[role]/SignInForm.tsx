"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { Checkbox, Divider, PasswordField, TextField } from "@/components/auth/fields";
import { SignInProgress, SubmitButton } from "@/components/auth/SubmitButton";
import { useSignIn } from "@/components/auth/useSignIn";
import { Icon } from "@/components/icons";
import { COPY } from "@/design/copy";
import { PERSONAS, type Role } from "@/design/personas";
import { auth, cx } from "@/design/tokens";

const copy = COPY.signIn;

/**
 * One form for all three ways in. The role it was reached by is what the sign-in
 * writes down, so the app it lands in is the one you chose on the way here.
 */
export function SignInForm({ role }: { role: Role }) {
  const profile = PERSONAS[role];
  const { phase, action, signIn } = useSignIn(role);
  const [email, setEmail] = useState(profile.email);
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [linkSent, setLinkSent] = useState(false);

  return (
    <AuthScreen title={profile.signIn.title} subtitle={profile.signIn.subtitle}>
      <SignInProgress phase={phase} />

      {/* Which of the three this is, and the way back to the other two. */}
      <div className="mb-5 flex items-center gap-3 rounded-control border border-white/15 bg-white/[0.07] px-3.5 py-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-control border border-white/20 bg-white/10 text-white">
          <Icon name={profile.icon} size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] font-medium text-white">{profile.role}</span>
          <span className={cx("mt-0.5 block", auth.meta)}>{profile.org}</span>
        </span>
        <Link href="/login" className={cx(auth.link, "shrink-0")}>
          Change
        </Link>
      </div>

      <form onSubmit={signIn} className="space-y-4">
        <TextField
          label="Email address"
          icon="mail"
          type="email"
          autoComplete="email"
          required
          placeholder="you@yourcasaprogram.org"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        <PasswordField
          label="Password"
          icon="lock"
          autoComplete="current-password"
          required
          placeholder="Your password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          action={
            <Link href={`/login/${role}`} className={auth.link}>
              Forgot it?
            </Link>
          }
        />

        <div className="pt-1">
          <Checkbox label="Keep me signed in" checked={remember} onChange={setRemember} />
        </div>

        <SubmitButton
          phase={phase}
          action={action}
          label={copy.submitLabel}
          pendingLabel={copy.pendingLabel}
          className={cx(auth.primary, "mt-2")}
        />
      </form>

      <div className="mt-6 space-y-4">
        <Divider label={copy.dividerLabel} />

        {linkSent ? (
          <p className={auth.notice}>
            <Icon name="checkCircle" size={15} className="mt-px shrink-0" />
            <span>
              Sign-in link sent to <span className="font-medium">{email}</span>. It expires in 15
              minutes.
            </span>
          </p>
        ) : (
          <button
            type="button"
            onClick={() => setLinkSent(true)}
            disabled={phase !== "idle"}
            className={auth.secondary}
          >
            <Icon name={copy.alt.icon} size={15} />
            {copy.alt.label}
          </button>
        )}
      </div>
    </AuthScreen>
  );
}
