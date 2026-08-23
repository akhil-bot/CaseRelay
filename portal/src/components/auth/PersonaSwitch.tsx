"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { PERSONAS, PERSONA_ORDER, type Persona } from "@/design/personas";
import { auth, cx } from "@/design/tokens";

/**
 * Which sign-in you want is a choice between two products, not a toggle between
 * two states — so it opens as a menu that names both, rather than a button that
 * silently throws you at the other one.
 */
export function PersonaSwitch({ current }: { current?: Persona }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const active = current ? PERSONAS[current] : null;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={auth.switcher}
      >
        <Icon name={active?.icon ?? "swap"} size={12} />
        {active?.accountLabel ?? "Choose account"}
        <Icon name="chevronDown" size={12} className="opacity-70" />
      </button>

      {open && (
        <div role="menu" className={cx(auth.menu, "animate-rise")}>
          {PERSONA_ORDER.map((id) => {
            const profile = PERSONAS[id];
            const selected = id === current;
            return (
              <Link
                key={id}
                href={`/login/${id}`}
                role="menuitem"
                onClick={() => setOpen(false)}
                className={auth.menuItem}
              >
                <span className="flex size-6 shrink-0 items-center justify-center rounded-[5px] border border-white/20 bg-white/10 text-white">
                  <Icon name={profile.icon} size={12} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={auth.menuLabel}>{profile.accountLabel}</span>
                  <span className={auth.menuMeta}>{profile.role}</span>
                </span>
                {selected && <Icon name="check" size={12} className="shrink-0 text-white/70" />}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
