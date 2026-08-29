"use client";

import { useState, type ReactNode } from "react";
import { CaseRelayCopilot } from "@/components/copilot/CaseRelayCopilot";
import { Header } from "@/components/shell/Header";
import { Sidebar } from "@/components/shell/Sidebar";
import { cx, layout } from "@/design/tokens";

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

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
        <Header onOpenSidebar={() => setMobileNavOpen(true)} />

        <main className="min-w-0 flex-1">
          <div className={cx(layout.page, "animate-rise")}>
            {children}
          </div>
        </main>
      </div>

      <CaseRelayCopilot />
    </div>
  );
}
