"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/icons";
import { ViewSwitcher } from "@/components/shell/ViewSwitcher";
import { Avatar, Badge } from "@/components/ui/primitives";
import { cx, surface, type as type_ } from "@/design/tokens";
import { useViewer } from "@/lib/viewer";

const ADVOCATE_MENU: { icon: IconName; label: string; href?: string }[] = [
  { icon: "user", label: "Your profile" },
  { icon: "shield", label: "Your court authority" },
  { icon: "settings", label: "Reminder settings" },
  { icon: "logout", label: "Sign out", href: "/login/advocate" },
];

const PLATFORM_MENU: { icon: IconName; label: string; href?: string }[] = [
  { icon: "identity", label: "Service identities" },
  { icon: "shield", label: "Policy rule set" },
  { icon: "settings", label: "Runtime configuration" },
  { icon: "logout", label: "Sign out", href: "/login/platform" },
];

export function ProfileMenu() {
  const { profile, showsTechnical } = useViewer();
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

  const items = showsTechnical ? PLATFORM_MENU : ADVOCATE_MENU;

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
          <span className="block text-[11px] text-ink-muted">{profile.viewLabel} view</span>
        </span>
        <Icon name="chevronDown" size={15} className="text-ink-muted" />
      </button>

      {open && (
        <div
          role="menu"
          className={cx(surface.pop, "animate-rise absolute top-full right-0 z-30 mt-2 w-80 p-2")}
        >
          <div className="flex items-center gap-3 rounded-control bg-surface-soft px-3 py-3">
            <Avatar name={profile.name} size={38} variant={profile.tone} />
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-ink">{profile.name}</p>
              <p className="truncate text-[11.5px] text-ink-muted">{profile.email}</p>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5 px-1">
            <Badge variant={profile.tone} icon={profile.icon}>
              {profile.role}
            </Badge>
          </div>

          {/* A hairline, not a box: the popover is already a surface, and a
              bordered panel inside it makes the choice look like a settings
              form rather than two of the items in this menu. */}
          <div className="mt-2 border-t border-line pt-2">
            <p className={cx("px-2.5 pb-1", type_.label)}>Switch view</p>
            <ViewSwitcher />
          </div>

          <ul className="mt-2 space-y-0.5">
            {items.map((item) => {
              const itemClass =
                "flex w-full items-center gap-2.5 rounded-control px-3 py-2 text-left text-[13px] text-ink-soft transition-colors hover:bg-surface-soft hover:text-ink";
              return (
                <li key={item.label}>
                  {item.href ? (
                    <Link
                      href={item.href}
                      role="menuitem"
                      onClick={() => setOpen(false)}
                      className={itemClass}
                    >
                      <Icon name={item.icon} size={16} />
                      {item.label}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => setOpen(false)}
                      className={itemClass}
                    >
                      <Icon name={item.icon} size={16} />
                      {item.label}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          <p className={cx("border-t border-line px-3 pt-2.5 pb-1", type_.meta)}>
            {showsTechnical ? "On-call: platform team" : "Supervisor: Dana Whitfield"}
          </p>
        </div>
      )}
    </div>
  );
}
