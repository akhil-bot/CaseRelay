"use client";

import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { cx } from "@/design/tokens";
import { PERSONAS, PERSONA_ORDER } from "@/design/personas";
import { useViewer } from "@/lib/viewer";

/**
 * Switching view changes navigation, language, and how much technical detail is
 * shown. It also drops you back to the home route, because the route you were on
 * may not exist in the other view.
 */
export function ViewSwitcher({ compact = false }: { compact?: boolean }) {
  const { persona, setPersona } = useViewer();
  const router = useRouter();

  return (
    <div
      className="flex items-center gap-0.5 rounded-full border border-line bg-surface-soft p-0.5"
      role="group"
      aria-label="Switch view"
    >
      {PERSONA_ORDER.map((id) => {
        const option = PERSONAS[id];
        const active = persona === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => {
              setPersona(id);
              router.push("/");
            }}
            aria-pressed={active}
            title={option.viewHint}
            className={cx(
              "flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12px] font-medium transition-colors",
              active
                ? "bg-surface text-brand-deep shadow-card"
                : "text-ink-muted hover:text-ink-soft",
            )}
          >
            <Icon name={option.icon} size={14} />
            {!compact && option.viewLabel}
          </button>
        );
      })}
    </div>
  );
}
