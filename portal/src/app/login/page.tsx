import Link from "next/link";
import { AuthBackdrop, AuthPanel } from "@/components/auth/frame";
import { Icon } from "@/components/icons";
import { Logo } from "@/components/Logo";
import { PERSONAS, ROLE_ORDER } from "@/design/personas";
import { auth, cx } from "@/design/tokens";

/**
 * Which of the three you are.
 *
 * The choice is made before the password, not after, because it decides what
 * the product is: the advocate works cases, the supervisor holds the authority
 * to let one start, the admin runs the fleet underneath both.
 */
export default function LoginChooserPage() {
  return (
    <div className={auth.screen}>
      <AuthBackdrop src="/auth-advocate.png" />

      <AuthPanel>
        <span aria-hidden="true" className={auth.headlineQuote}>
          &ldquo;
        </span>
        <h1 className={cx("mt-4", auth.headline)}>
          A promise made for a child should never quietly go missing.
        </h1>
        <p className={cx("mt-3 max-w-[46ch]", auth.lede)}>
          CaseRelay tracks who promised what, and chases the steps nobody has claimed.
        </p>
      </AuthPanel>

      <div className={auth.column}>
        <header className="flex items-center justify-between gap-3">
          <span className="lg:invisible">
            <Logo size={30} variant="light" />
          </span>
        </header>

        <main className="flex flex-1 items-center py-10">
          <div className={auth.form}>
            <h2 className={auth.title}>Sign in to CaseRelay</h2>
            <p className={cx("mt-1.5", auth.subtitle)}>
              Choose the account you are signing in with.
            </p>

            <div className="mt-7 space-y-2.5">
              {ROLE_ORDER.map((role) => {
                const profile = PERSONAS[role];
                return (
                  <Link
                    key={role}
                    href={`/login/${role}`}
                    className="flex items-start gap-3.5 rounded-card border border-white/15 bg-white/[0.07] px-4 py-4 transition-colors hover:border-white/30 hover:bg-white/15"
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-control border border-white/20 bg-white/10 text-white">
                      <Icon name={profile.icon} size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] font-semibold text-white">
                        {profile.role}
                      </span>
                      <span className={cx("mt-1 block", auth.meta)}>{profile.viewHint}</span>
                    </span>
                    <Icon name="chevronRight" size={16} className="mt-2.5 shrink-0 text-white/50" />
                  </Link>
                );
              })}
            </div>
          </div>
        </main>

        <footer className={auth.form}>
          <p className={auth.meta}>Synthetic demo data. Not connected to any real case system.</p>
        </footer>
      </div>
    </div>
  );
}
