"use client";

import { useState } from "react";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { Divider, PasswordField, TextField } from "@/components/auth/fields";
import { SignInProgress, SubmitButton } from "@/components/auth/SubmitButton";
import { useSignIn } from "@/components/auth/useSignIn";
import { COPY } from "@/design/copy";
import { PERSONAS } from "@/design/personas";
import { auth, cx } from "@/design/tokens";

const copy = COPY.platform.signIn;

export default function PlatformLoginPage() {
  const { phase, action, signIn } = useSignIn("platform");
  const [workspace, setWorkspace] = useState("caserelay-platform");
  const [email, setEmail] = useState(PERSONAS.platform.email);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");

  return (
    <AuthScreen persona="platform">
      <SignInProgress phase={phase} />

      <form onSubmit={signIn} className="space-y-4">
        <TextField
          label="Workspace"
          icon="gateway"
          required
          spellCheck={false}
          autoCapitalize="none"
          className="font-mono text-[13px] tracking-tight"
          placeholder="your-workspace"
          value={workspace}
          onChange={(event) => setWorkspace(event.target.value)}
        />

        <SubmitButton
          phase={phase}
          action={action}
          value="sso"
          label={copy.alt.label}
          pendingLabel="Redirecting…"
          doneLabel="Verified"
          icon={copy.alt.icon}
          className={auth.primary}
        />

        <div className="pt-2">
          <Divider label={copy.dividerLabel} />
        </div>

        <TextField
          label="Work email"
          icon="mail"
          type="email"
          autoComplete="username"
          required
          placeholder="you@caserelay.example"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        <PasswordField
          label="Password"
          icon="lock"
          autoComplete="current-password"
          required
          placeholder="Directory password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        <TextField
          label="Verification code"
          icon="shield"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          required
          placeholder="000000"
          className="font-mono text-[14px] tracking-[0.4em]"
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
        />

        <SubmitButton
          phase={phase}
          action={action}
          value="directory"
          label={copy.submitLabel}
          pendingLabel={copy.pendingLabel}
          className={cx(auth.secondary, "mt-2")}
        />
      </form>
    </AuthScreen>
  );
}
