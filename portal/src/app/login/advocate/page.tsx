"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { Checkbox, Divider, PasswordField, TextField } from "@/components/auth/fields";
import { SignInProgress, SubmitButton } from "@/components/auth/SubmitButton";
import { useSignIn } from "@/components/auth/useSignIn";
import { Icon } from "@/components/icons";
import { COPY } from "@/design/copy";
import { PERSONAS } from "@/design/personas";
import { auth, cx } from "@/design/tokens";

const copy = COPY.advocate.signIn;

export default function AdvocateLoginPage() {
  const { phase, action, signIn } = useSignIn("advocate");
  const [email, setEmail] = useState(PERSONAS.advocate.email);
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [linkSent, setLinkSent] = useState(false);

  return (
    <AuthScreen persona="advocate">
      <SignInProgress phase={phase} />

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
            <Link href="/login/advocate" className={auth.link}>
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
