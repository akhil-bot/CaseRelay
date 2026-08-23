import Link from "next/link";
import type { ReactNode } from "react";
import { AuthBackdrop, AuthPanel } from "@/components/auth/frame";
import { PersonaSwitch } from "@/components/auth/PersonaSwitch";
import { Logo } from "@/components/Logo";
import { COPY } from "@/design/copy";
import type { Persona } from "@/design/personas";
import { auth, cx } from "@/design/tokens";

/**
 * The artwork is the one place the two products are allowed to differ in kind. A
 * volunteer signs in because of a child, so she gets a child. An operator signs
 * in to a fleet, so they get the fleet.
 */
const PANEL_ART: Record<Persona, string> = {
  advocate: "/auth-advocate.png",
  platform: "/auth-platform.png",
};

export function AuthScreen({ persona, children }: { persona: Persona; children: ReactNode }) {
  const copy = COPY[persona].signIn;

  return (
    <div className={auth.screen}>
      <AuthBackdrop src={PANEL_ART[persona]} />

      <AuthPanel>
        <span aria-hidden="true" className={auth.headlineQuote}>
          &ldquo;
        </span>
        <h1 className={cx("mt-4", auth.headline)}>
          <Claim text={copy.panel.headline} emphasis={copy.panel.emphasis} />
        </h1>
        <p className={cx("mt-3 max-w-[46ch]", auth.lede)}>{copy.panel.body}</p>
      </AuthPanel>

      <div className={auth.column}>
        <header className="flex items-center justify-between gap-3">
          <Link href="/login" className="lg:invisible">
            <Logo size={30} variant="light" />
          </Link>
          <PersonaSwitch current={persona} />
        </header>

        <main className="flex flex-1 items-center py-10">
          <div className={auth.form}>
            <h2 className={auth.title}>{copy.title}</h2>
            <p className={cx("mt-1.5", auth.subtitle)}>{copy.subtitle}</p>

            <div className="mt-7">{children}</div>
          </div>
        </main>

        <footer className={auth.form}>
          <p className={auth.meta}>Synthetic demo data. Not connected to any real case system.</p>
        </footer>
      </div>
    </div>
  );
}

/**
 * Renders the headline with its emphasised phrase fading out. The phrase stays
 * part of the same sentence — screen readers and selection see one string.
 */
function Claim({ text, emphasis }: { text: string; emphasis?: string }) {
  const at = emphasis ? text.indexOf(emphasis) : -1;
  if (!emphasis || at < 0) return text;

  return (
    <>
      {text.slice(0, at)}
      <span className={auth.headlineFade}>{emphasis}</span>
      {text.slice(at + emphasis.length)}
    </>
  );
}
