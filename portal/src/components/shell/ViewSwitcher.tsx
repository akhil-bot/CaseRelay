"use client";

import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { cx, tone } from "@/design/tokens";
import { PERSONAS, PERSONA_ORDER } from "@/design/personas";
import { useViewer } from "@/lib/viewer";

/**
 * Switching view changes navigation, language, and how much technical detail is
 * shown. It also drops you back to the home route, because the route you were on
 * may not exist in the other view.
 *
 * That is too much to hang on a segmented pill. A pill has room for two words and
 * shows the state you are already in; what you need before switching is a line
 * about the view you are not in. So both views are stated in full, as rows — the
 * same shape the sign-in screen uses to offer the same two choices.
 */
export function ViewSwitcher() {
  const { persona, setPersona } = useViewer();
  const router = useRouter();

  return (
    <div role="radiogroup" aria-label="Switch view" className="space-y-0.5">
      {PERSONA_ORDER.map((id) => {
        const option = PERSONAS[id];
        const active = persona === id;
        const paint = tone[option.tone];

        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => {
              setPersona(id);
              router.push("/");
            }}
            className={cx(
              "flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-left",
              active ? paint.soft : "transition-colors hover:bg-surface-soft",
            )}
          >
            <span
              className={cx(
                "flex size-7 shrink-0 items-center justify-center rounded-control border",
                active ? paint.badge : tone.neutral.badge,
              )}
            >
              <Icon name={option.icon} size={14} />
            </span>

            <span className="min-w-0 flex-1">
              <span
                className={cx(
                  "block text-[13px] leading-tight",
                  active ? cx("font-medium", paint.text) : "text-ink",
                )}
              >
                {option.viewLabel}
              </span>
              <span className="mt-0.5 block text-[11.5px] leading-snug text-ink-muted">
                {option.viewHint}
              </span>
            </span>

            {active && <Icon name="check" size={15} className={cx("shrink-0", paint.text)} />}
          </button>
        );
      })}
    </div>
  );
}
