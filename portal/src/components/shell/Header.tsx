"use client";

import { usePathname } from "next/navigation";
import { Icon } from "@/components/icons";
import { Notifications } from "@/components/shell/Notifications";
import { ProfileMenu } from "@/components/shell/ProfileMenu";
import { COPY } from "@/design/copy";
import { pageKeyFor, PLATFORM_ONLY_ROUTES } from "@/design/personas";
import { chrome, control, cx, type as type_ } from "@/design/tokens";
import { useViewer } from "@/lib/viewer";

export function Header({
  onOpenSidebar,
  onToggleActivity,
  activityOpen,
}: {
  onOpenSidebar: () => void;
  onToggleActivity: () => void;
  activityOpen: boolean;
}) {
  const pathname = usePathname() ?? "/";
  const { copy, showsTechnical } = useViewer();
  const key = pageKeyFor(pathname);
  const isPlatformOnly = PLATFORM_ONLY_ROUTES.some((r) => pathname.startsWith(r));
  const heading = isPlatformOnly ? COPY.platform.pages[key] : copy.pages[key];

  return (
    // The height sits on the element that carries the hairline, so the row is
    // 64px including it and the sidebar's own header ends on the same line.
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

      {showsTechnical && (
        <button
          type="button"
          onClick={onToggleActivity}
          aria-pressed={activityOpen}
          aria-label="Toggle agent activity"
          title="Agent activity"
          className={cx(
            control.icon,
            "hidden lg:inline-flex",
            activityOpen && "border-brand/35 bg-brand-soft text-brand-deep",
          )}
        >
          <Icon name="activity" size={17} />
        </button>
      )}

      <span className="hidden h-7 w-px bg-line md:block" aria-hidden="true" />

      <ProfileMenu />
    </header>
  );
}
