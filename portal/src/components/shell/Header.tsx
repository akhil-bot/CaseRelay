"use client";

import { usePathname } from "next/navigation";
import { Icon } from "@/components/icons";
import { Notifications } from "@/components/shell/Notifications";
import { ProfileMenu } from "@/components/shell/ProfileMenu";
import { pageKeyFor } from "@/design/personas";
import { chrome, control, cx, type as type_ } from "@/design/tokens";
import { useViewer } from "@/lib/viewer";

export function Header({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  const pathname = usePathname() ?? "/";
  const { copy } = useViewer();
  const key = pageKeyFor(pathname);
  const heading = copy.pages[key];

  return (
    <header
      className={cx(
        chrome.row,
        "sticky top-0 z-20 gap-3 bg-surface/90 px-4 backdrop-blur sm:px-6 2xl:px-8",
      )}
    >
      <button
        type="button"
        onClick={onOpenSidebar}
        aria-label="Open navigation"
        className={cx(control.icon, "lg:hidden")}
      >
        <Icon name="panel" size={17} />
      </button>

      <div className="min-w-0 flex-1">
        <h1 className={cx(type_.pageTitle, chrome.title)}>{heading.title}</h1>
        <p className={cx(chrome.subtitle, "text-[12px] text-ink-muted")}>{heading.subtitle}</p>
      </div>

      <Notifications />

      <span className="hidden h-7 w-px bg-line md:block" aria-hidden="true" />

      <ProfileMenu />
    </header>
  );
}
