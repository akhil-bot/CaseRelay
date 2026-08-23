"use client";

import { usePathname } from "next/navigation";
import { Icon } from "@/components/icons";
import { CaseSearch } from "@/components/shell/CaseSearch";
import { Notifications } from "@/components/shell/Notifications";
import { ProfileMenu } from "@/components/shell/ProfileMenu";
import { pageKeyFor } from "@/design/personas";
import { control, cx, type as type_ } from "@/design/tokens";
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
  const heading = copy.pages[pageKeyFor(pathname)];

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6 2xl:px-8">
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label="Open navigation"
          className={cx(control.icon, "lg:hidden")}
        >
          <Icon name="panel" size={17} />
        </button>

        <div className="min-w-0 flex-1">
          <h1 className={type_.pageTitle}>{heading.title}</h1>
          <p className="truncate text-[12.5px] text-ink-muted">{heading.subtitle}</p>
        </div>

        <CaseSearch />

        <span className="hidden h-7 w-px bg-line md:block" aria-hidden="true" />

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
      </div>
    </header>
  );
}
