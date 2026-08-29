"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/icons";
import { Avatar, Badge } from "@/components/ui/primitives";
import { PERSONAS, ROLE_ORDER } from "@/design/personas";
import { cx, surface, tone, type as type_ } from "@/design/tokens";
import { useViewer } from "@/lib/viewer";

/**
 * Where the account goes.
 *
 * Signing out is not in this list. It ends the session rather than moving
 * around inside it, so it sits under a rule of its own at the foot of the menu,
 * away from anything you might hit on the way past.
 */
const MENU_ITEMS: { icon: IconName; label: string; href?: string }[] = [
  { icon: "user", label: "Your profile" },
  { icon: "shield", label: "Your court authority" },
  { icon: "settings", label: "Reminder settings" },
];

const ITEM =
  "flex w-full items-center gap-2.5 rounded-control px-3 py-2 text-left text-[13px] text-ink-soft transition-colors hover:bg-surface-soft hover:text-ink";

export function ProfileMenu() {
  const { profile, role, setRole } = useViewer();
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

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2.5 rounded-full border border-line bg-surface py-1 pr-2.5 pl-1 transition-colors hover:bg-surface-soft"
      >
        <Avatar name={profile.name} size={30} variant={profile.tone} />
        <span className="hidden text-left sm:block">
          <span className="block text-[12.5px] leading-tight font-medium text-ink">
            {profile.name}
          </span>
          <span className="block text-[11px] text-ink-muted">{profile.accountLabel}</span>
        </span>
        <Icon name="chevronDown" size={15} className="text-ink-muted" />
      </button>

      {open && (
        <div
          role="menu"
          className={cx(surface.pop, "animate-rise absolute top-full right-0 z-30 mt-2 w-80 p-2")}
        >
          {/* Who you are signed in as, in one block: name, address, and the
              standing that decides what you may see. The role belongs here
              rather than in a strip of its own below — it describes the person
              in this card, and on its own it read as neither part of the
              identity nor part of the menu under it. */}
          <div className="flex items-start gap-3 rounded-control bg-surface-soft px-3 py-3">
            <Avatar name={profile.name} size={38} variant={profile.tone} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-ink">{profile.name}</p>
              <p className="truncate text-[11.5px] text-ink-muted">{profile.email}</p>
              <span className="mt-2 flex">
                <Badge variant={profile.tone} icon={profile.icon}>
                  {profile.role}
                </Badge>
              </span>
            </div>
          </div>

          <p className={cx("flex items-center gap-1.5 px-3 pt-2.5 pb-0.5", type_.meta)}>
            <Icon name="home" size={12} className="shrink-0" />
            {profile.org}
          </p>

          <div className="mt-1.5 space-y-0.5">
            {MENU_ITEMS.map((item) =>
              item.href ? (
                <Link
                  key={item.label}
                  href={item.href}
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className={ITEM}
                >
                  <Icon name={item.icon} size={16} />
                  {item.label}
                </Link>
              ) : (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className={ITEM}
                >
                  <Icon name={item.icon} size={16} />
                  {item.label}
                </button>
              ),
            )}
          </div>

          {/* Left open on purpose after switching: the sidebar and half the
              product change behind the menu, and the way back is the row you
              just used. */}
          <div className="mt-1.5 border-t border-line pt-1.5">
            <p className={cx("px-3 pb-1.5", type_.label)}>Switch view</p>
            {ROLE_ORDER.map((option) => {
              const persona = PERSONAS[option];
              const active = option === role;
              return (
                <button
                  key={option}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => setRole(option)}
                  className={cx(ITEM, active && "bg-surface-soft text-ink")}
                >
                  <span
                    className={cx(
                      "flex size-6 shrink-0 items-center justify-center rounded-full border",
                      tone[persona.tone].badge,
                    )}
                  >
                    <Icon name={persona.icon} size={13} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{persona.viewLabel}</span>
                  {active && <Icon name="check" size={14} className="shrink-0 text-brand" />}
                </button>
              );
            })}
          </div>

          <div className="mt-1.5 border-t border-line pt-1.5">
            <Link
              href="/login"
              role="menuitem"
              onClick={() => setOpen(false)}
              className={cx(ITEM, "hover:bg-danger/5 hover:text-danger")}
            >
              <Icon name="logout" size={16} />
              Sign out
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
