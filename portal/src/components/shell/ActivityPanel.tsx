"use client";

import { Icon, type IconName } from "@/components/icons";
import { Badge } from "@/components/ui/primitives";
import { chrome, cx, type as type_, type Tone } from "@/design/tokens";
import { useDemo } from "@/lib/demo-store";
import { WORKFLOW_ID } from "@/lib/mock/cases";
import type { ActivityKind } from "@/lib/types";

export const KIND_META: Record<
  ActivityKind,
  { label: string; variant: Tone; icon: IconName }
> = {
  registry: { label: "Registry", variant: "brand", icon: "registry" },
  runtime: { label: "Runtime", variant: "brand", icon: "activity" },
  memory: { label: "Memory", variant: "accent", icon: "memory" },
  identity: { label: "Identity", variant: "accent", icon: "identity" },
  gateway: { label: "Gateway", variant: "brand", icon: "gateway" },
  model: { label: "Model", variant: "neutral", icon: "sparkle" },
  tool: { label: "Tool", variant: "neutral", icon: "settings" },
  policy: { label: "Policy", variant: "warn", icon: "shield" },
  armor: { label: "Model Armor", variant: "danger", icon: "lock" },
  approval: { label: "Human", variant: "seal", icon: "user" },
  retry: { label: "Retry", variant: "warn", icon: "retry" },
  callback: { label: "Callback", variant: "accent", icon: "mail" },
  audit: { label: "Audit", variant: "seal", icon: "audit" },
};

export function ActivityPanel({ onClose }: { onClose?: () => void }) {
  const { activity, capabilities } = useDemo();
  const recent = [...activity].reverse();
  const proven = capabilities.filter((item) => item.proven).length;

  return (
    <aside className="flex h-full min-h-0 flex-col border-l border-line bg-surface">
      <div className={cx(chrome.row, "gap-2 px-4")}>
        <span className="flex size-7 items-center justify-center rounded-full bg-brand-soft text-brand">
          <Icon name="activity" size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <p className={cx(chrome.title, "text-[13px] font-semibold text-ink")}>Agent activity</p>
          <p className={cx(chrome.subtitle, "font-mono text-[10.5px] text-ink-muted")}>
            {activity.length} spans recorded
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close agent activity"
            className="flex size-7 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-soft hover:text-ink"
          >
            <Icon name="close" size={15} />
          </button>
        )}
      </div>

      <div className="shrink-0 border-b border-line bg-surface-soft px-4 py-3">
        <dl className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-[11.5px] text-ink-muted">Trace</dt>
            <dd className="font-mono text-[11.5px] text-ink-muted">—</dd>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-[11.5px] text-ink-muted">Workflow</dt>
            <dd className="font-mono text-[11.5px] text-ink-soft">{WORKFLOW_ID}</dd>
          </div>
        </dl>

        <p className={cx("mt-3", type_.label)}>
          Capabilities proven {proven}/{capabilities.length}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {capabilities.map((capability) => (
            <span
              key={capability.key}
              title={capability.proven ? capability.evidence : "Not demonstrated yet"}
              className={cx(
                "rounded-full border px-2 py-0.5 text-[10.5px]",
                capability.proven
                  ? "border-seal/25 bg-seal-soft font-medium text-seal"
                  : "border-line bg-surface text-ink-muted",
              )}
            >
              {capability.label}
            </span>
          ))}
        </div>
      </div>

      <ol className="thin-scroll min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {recent.map((event) => {
          const meta = KIND_META[event.kind];
          return (
            <li key={event.id} className="animate-rise rounded-control px-2 py-2 hover:bg-surface-soft">
              <div className="flex items-center gap-2">
                <Badge variant={meta.variant} icon={meta.icon}>
                  {meta.label}
                </Badge>
                <span className="ml-auto font-mono text-[10px] text-ink-muted">
                  {event.spanMs > 0 ? `${event.spanMs}ms` : "human"}
                </span>
              </div>
              <p className="mt-1.5 text-[12.5px] leading-snug text-ink">{event.summary}</p>
              <p className="mt-0.5 font-mono text-[10px] text-ink-muted">{event.at}</p>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
