"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/icons";
import { Logo } from "@/components/Logo";
import { Badge } from "@/components/ui/primitives";
import { ROLE_ORDER, type NavItem } from "@/design/personas";
import { chrome, cx, type as type_ } from "@/design/tokens";
import { useLiveApprovals } from "@/lib/live-approvals";
import { useViewer } from "@/lib/viewer";

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname() ?? "/";
  const { gates } = useLiveApprovals();
  const { navByRole, copy } = useViewer();

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className={cx(chrome.row, "px-5")}>
        <Logo size={33} />
      </div>

      {/*
        Every role's navigation is rendered and CSS reveals the one signed in,
        off the role written to <html> before the first paint. Filtering here
        instead would paint one role's items and swap them for another's on
        every load, because the server cannot read who is signed in.
      */}
      <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Main">
        {ROLE_ORDER.map((role) => (
          <div key={role} data-role-group={role}>
            {navByRole[role].map((group, index) => (
              <div key={group.label} className={cx(index > 0 && "mt-5")}>
                <p className={cx("px-2 pb-2", type_.label)}>{group.label}</p>
                <ul className="space-y-0.5">
                  {group.items.map((item) => (
                    <li key={item.href}>
                      <NavLink
                        item={item}
                        active={
                          item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)
                        }
                        count={item.badge === "approvals" ? gates.length : 0}
                        onNavigate={onNavigate}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ))}
      </nav>

      <div className="border-t border-line p-3">
        <div className="rounded-control bg-brand-soft px-3 py-2.5">
          <Badge variant="brand" icon="shield">
            {copy.sidebar.footerTitle}
          </Badge>
          <p className="mt-2 text-[11.5px] leading-relaxed text-ink-soft">
            {copy.sidebar.footerNote}
          </p>
        </div>
      </div>
    </div>
  );
}

function NavLink({
  item,
  active,
  count,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  count: number;
  onNavigate?: () => void;
}) {
  return (
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
  );
}
