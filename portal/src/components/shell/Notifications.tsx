"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/icons";
import { Badge } from "@/components/ui/primitives";
import { cx, surface, type as type_, type Tone } from "@/design/tokens";
import { useDemo } from "@/lib/demo-store";
import { useLiveApprovals } from "@/lib/live-approvals";
import { PRIMARY_CASE_ID } from "@/lib/mock/cases";
import { useViewer } from "@/lib/viewer";

export function Notifications() {
  const { commitments, activity, step } = useDemo();
  const { gates } = useLiveApprovals();
  const { role } = useViewer();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const overdue = commitments.filter((item) => (item.daysOverdue ?? 0) > 0);
  const latest = activity.at(-1);

  const items: {
    id: string;
    icon: IconName;
    variant: Tone;
    title: string;
    body: string;
    href: string;
  }[] = [
    // Only the supervisor is being asked for something. For anyone else the
    // gate is still news — their case has stopped — but it names who is holding
    // it, and points at the case rather than a queue they cannot act on.
    ...gates.map((gate) => ({
      id: gate.key,
      icon: "approvals" as IconName,
      variant: "accent" as Tone,
      title:
        role === "supervisor"
          ? gate.kind === "activation"
            ? `${gate.childName}'s case cannot start until you approve it`
            : `${gate.childName}'s case is paused until you decide`
          : gate.kind === "activation"
            ? `${gate.childName}'s case cannot start until your supervisor approves it`
            : `${gate.childName}'s case is paused until your supervisor decides`,
      body: gate.reason ?? gate.caseId,
      href: role === "supervisor" ? "/approvals" : `/cases/${gate.caseId}`,
    })),
    ...overdue.map((commitment) => ({
      id: commitment.id,
      icon: "alert" as IconName,
      variant: "danger" as Tone,
      title: `Waiting ${commitment.daysOverdue} days with nobody responsible`,
      body: commitment.title,
      href: `/cases/${PRIMARY_CASE_ID}`,
    })),
    ...(latest && step > 0
      ? [
          {
            id: latest.id,
            icon: "activity" as IconName,
            variant: "brand" as Tone,
            title: latest.summary,
            body: latest.at,
            href: `/cases/${PRIMARY_CASE_ID}`,
          },
        ]
      : []),
  ];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={`Notifications (${items.length})`}
        className="relative flex size-9 items-center justify-center rounded-control border border-line bg-surface text-ink-soft transition-colors hover:bg-surface-soft hover:text-ink"
      >
        <Icon name="bell" size={17} />
        {items.length > 0 && (
          <span className="absolute -top-1 -right-1 flex min-w-4 items-center justify-center rounded-full bg-danger px-1 font-mono text-[9.5px] leading-4 text-white">
            {items.length}
          </span>
        )}
      </button>

      {open && (
        <div
          className={cx(surface.pop, "animate-rise absolute top-full right-0 z-30 mt-2 w-[340px] p-2")}
        >
          <div className="flex items-center justify-between px-2 py-1.5">
            <p className={type_.label}>Notifications</p>
            <Badge variant="neutral">{items.length}</Badge>
          </div>

          {items.length === 0 ? (
            <p className={cx("px-3 py-6 text-center", type_.meta)}>
              Nothing needs your attention right now.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {items.map((item) => (
                <li key={`${item.id}-${item.title}`}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="flex gap-3 rounded-control px-2.5 py-2.5 transition-colors hover:bg-surface-soft"
                  >
                    <span
                      className={cx(
                        "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border",
                        item.variant === "danger"
                          ? "border-danger/25 bg-danger-soft text-danger"
                          : item.variant === "accent"
                            ? "border-accent/25 bg-accent-soft text-accent-deep"
                            : "border-brand/25 bg-brand-soft text-brand-deep",
                      )}
                    >
                      <Icon name={item.icon} size={14} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[12.5px] font-medium text-ink">{item.title}</span>
                      <span className="mt-0.5 block text-[11.5px] leading-relaxed text-ink-muted">
                        {item.body}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
