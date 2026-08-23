"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/icons";
import { Logo } from "@/components/Logo";
import { ScenarioControl } from "@/components/shell/ScenarioControl";
import { Badge } from "@/components/ui/primitives";
import { chrome, cx, type as type_ } from "@/design/tokens";
import { useDemo } from "@/lib/demo-store";
import { useViewer } from "@/lib/viewer";

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname() ?? "/";
  const { pendingApprovals } = useDemo();
  const { nav, copy } = useViewer();

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className={cx(chrome.row, "px-5")}>
        <Logo size={33} />
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Main">
        <p className={cx("px-2 pb-2", type_.label)}>{copy.sidebar.sectionLabel}</p>
        <ul className="space-y-0.5">
          {nav.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            const count = item.badge === "approvals" ? pendingApprovals.length : 0;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "flex items-center gap-3 rounded-control px-2.5 py-2.5 text-[13.5px] transition-colors",
                    active
                      ? "bg-brand-soft font-medium text-brand-deep"
                      : "text-ink-soft hover:bg-surface-soft hover:text-ink",
                  )}
                >
                  <Icon name={item.icon} size={18} className="shrink-0" />
                  <span className="flex-1 truncate">{item.label}</span>
                  {count > 0 && (
                    <span className="rounded-full bg-accent px-1.5 py-0.5 font-mono text-[10px] text-white">
                      {count}
                    </span>
                  )}
                  {active && <Icon name="chevronRight" size={15} className="shrink-0 opacity-60" />}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-line p-3">
        <ScenarioControl />

        <div className="mt-3 rounded-control bg-surface-soft px-3 py-2.5">
          <Badge variant="warn" icon="shield">
            Synthetic demo data
          </Badge>
          <p className="mt-2 text-[11.5px] leading-relaxed text-ink-muted">
            {copy.sidebar.footerNote}
          </p>
        </div>
      </div>
    </div>
  );
}
