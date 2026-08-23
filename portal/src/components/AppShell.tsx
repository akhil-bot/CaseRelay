"use client";

import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { CaseRelayCopilot } from "@/components/copilot/CaseRelayCopilot";
import { ActivityPanel } from "@/components/shell/ActivityPanel";
import { Header } from "@/components/shell/Header";
import { Sidebar } from "@/components/shell/Sidebar";
import { cx, layout } from "@/design/tokens";
import { useViewer } from "@/lib/viewer";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { persona, showsTechnical } = useViewer();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(true);

  // The agent activity feed is spans, identities and trace IDs: platform view only.
  const showActivity = showsTechnical && activityOpen;

  return (
    <div className="flex min-h-screen">
      <div
        className={cx(
          layout.sidebarWidth,
          "sticky top-0 hidden h-screen shrink-0 border-r border-line lg:block",
        )}
      >
        <Sidebar />
      </div>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setMobileNavOpen(false)}
            className="absolute inset-0 bg-ink/30"
          />
          <div
            className={cx(
              layout.sidebarWidth,
              "animate-rise absolute inset-y-0 left-0 border-r border-line shadow-pop",
            )}
          >
            <Sidebar onNavigate={() => setMobileNavOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          onOpenSidebar={() => setMobileNavOpen(true)}
          onToggleActivity={() => setActivityOpen((value) => !value)}
          activityOpen={activityOpen}
        />

        <div className="flex min-h-0 flex-1">
          <main className="min-w-0 flex-1">
            <div key={`${persona}-${pathname}`} className={cx(layout.page, "animate-rise")}>
              {children}
            </div>
          </main>

          {showActivity && (
            <div className="hidden w-[300px] shrink-0 lg:block 2xl:w-[340px]">
              <div className="sticky top-16 h-[calc(100vh-4rem)]">
                <ActivityPanel onClose={() => setActivityOpen(false)} />
              </div>
            </div>
          )}
        </div>
      </div>

      <CaseRelayCopilot />
    </div>
  );
}
