"use client";

import { useMemo, useState } from "react";
import { Icon, type IconName } from "@/components/icons";
import { AccessNotice } from "@/components/shell/AccessNotice";
import { Badge, Card, Field, HealthBadge, Mono, Note, cx } from "@/components/ui/primitives";
import { control, layout, surface, tone, type as type_, type Tone } from "@/design/tokens";
import { useDemo } from "@/lib/demo-store";
import { AGENTS } from "@/lib/mock/agents";
import { useViewer } from "@/lib/viewer";
import type { AgentCard, CapabilityKey } from "@/lib/types";

const OWNER_FILTERS = [
  { id: "all", label: "All owners", icon: "agents" as IconName },
  { id: "casa", label: "CASA program", icon: "home" as IconName },
  { id: "partner", label: "Partner organizations", icon: "users" as IconName },
  { id: "compliance", label: "Compliance", icon: "shield" as IconName },
] as const;

const OWNER_KIND_META: Record<AgentCard["ownerKind"], { label: string; variant: Tone }> = {
  casa: { label: "CASA program", variant: "brand" },
  partner: { label: "Partner org", variant: "neutral" },
  compliance: { label: "Compliance", variant: "warn" },
};

const CAPABILITY_ICONS: Record<CapabilityKey, IconName> = {
  registry: "registry",
  runtime: "activity",
  memory: "memory",
  identity: "identity",
  gateway: "gateway",
  model_armor: "lock",
  observability: "audit",
};

export default function AgentsPage() {
  const { step, capabilities } = useDemo();
  const { showsTechnical } = useViewer();
  const [filter, setFilter] = useState<(typeof OWNER_FILTERS)[number]["id"]>("all");
  const [selectedId, setSelectedId] = useState(AGENTS[2].id);

  const visible = useMemo(
    () => (filter === "all" ? AGENTS : AGENTS.filter((agent) => agent.ownerKind === filter)),
    [filter],
  );
  const selected = AGENTS.find((agent) => agent.id === selectedId) ?? AGENTS[0];
  const discovered = step >= 1;

  if (!showsTechnical) {
    return <AccessNotice what="The agent registry" />;
  }

  return (
    <div className={layout.stack}>
      <section className={cx(surface.card, "px-4 py-4")}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className={type_.sectionTitle}>Eight agents, eight owners, eight identities</p>
            <p className={cx("mt-1", layout.measure, type_.small)}>
              Discovery is how the Orchestrator finds a partner. It never hardcodes one.
            </p>
          </div>
          <Badge variant={discovered ? "brand" : "neutral"} icon={discovered ? "check" : "clock"}>
            {discovered ? "5 partner cards resolved on Day 0" : "Discovery not yet run"}
          </Badge>
        </div>

        <div className="mt-3.5 flex flex-wrap gap-1.5">
          {OWNER_FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setFilter(option.id)}
              className={filter === option.id ? control.chipActive : control.chip}
            >
              <Icon name={option.icon} size={14} />
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,400px)] 3xl:grid-cols-[minmax(0,1fr)_minmax(0,460px)]">
        <Card
          icon="registry"
          title="Registry"
          subtitle="Select an agent to inspect its card."
          action={<span className={type_.meta}>{visible.length} agents</span>}
          bodyClassName="px-3 py-3"
        >
          <ul className="grid gap-2 3xl:grid-cols-2">
            {visible.map((agent) => {
              const owner = OWNER_KIND_META[agent.ownerKind];
              const active = agent.id === selectedId;
              return (
                <li key={agent.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(agent.id)}
                    className={cx(
                      "w-full rounded-control border px-4 py-3.5 text-left transition-colors",
                      active
                        ? "border-brand/30 bg-brand-soft"
                        : "border-line bg-surface-soft hover:bg-surface-muted",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span
                        className={cx(
                          "flex size-8 shrink-0 items-center justify-center rounded-control border",
                          tone[owner.variant].badge,
                        )}
                      >
                        <Icon name="agents" size={16} />
                      </span>
                      <span className="text-[13.5px] font-semibold text-ink">{agent.name}</span>
                      <Badge variant="neutral">v{agent.version}</Badge>
                      <span className="ml-auto">
                        <HealthBadge health={agent.health} />
                      </span>
                    </div>
                    <p className={cx("mt-1.5", type_.meta)}>{agent.owner}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-muted">
                      <Mono className="text-[11px]">{agent.identity}</Mono>
                      <span className="flex items-center gap-1">
                        <Icon name="clock" size={12} />
                        p50 {agent.p50Ms}ms
                      </span>
                      <span className="flex items-center gap-1">
                        <Icon name="activity" size={12} />
                        {agent.lastHeartbeat}
                      </span>
                      <span className="flex items-center gap-1">
                        <Icon name="settings" size={12} />
                        {agent.tools.length} tools
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>

        <AgentDetail agent={selected} />
      </div>

      <Card
        icon="shield"
        title="Fleet capability proof"
        subtitle="What has actually been demonstrated at the current point in the scenario."
        bodyClassName="px-3 py-3"
      >
        <ul className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3 3xl:grid-cols-4">
          {capabilities.map((capability) => (
            <li
              key={capability.key}
              className={cx(
                "rounded-control border px-3.5 py-3",
                capability.proven ? "border-seal/20 bg-seal-soft" : "border-line bg-surface-soft",
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cx(
                    "flex size-7 shrink-0 items-center justify-center rounded-full border",
                    capability.proven
                      ? tone.seal.badge
                      : "border-line-strong bg-surface text-ink-muted",
                  )}
                >
                  <Icon name={CAPABILITY_ICONS[capability.key]} size={14} />
                </span>
                <span className="text-[12.5px] font-medium text-ink">{capability.label}</span>
                <Badge
                  variant={capability.proven ? "seal" : "neutral"}
                  className="ml-auto"
                  icon={capability.proven ? "checkCircle" : "clock"}
                >
                  {capability.proven ? "Demonstrated" : `Step ${capability.provenAtStep + 1}`}
                </Badge>
              </div>
              <p className={cx("mt-2", type_.meta)}>{capability.managedProduct}</p>
              <p className="mt-1 text-[12px] text-ink-soft">{capability.evidence}</p>
            </li>
          ))}
        </ul>
      </Card>

      <Note icon="alert">
        Health, latency, and endpoint values here are illustrative. This build is a UI prototype: no
        agent is deployed and no request leaves the browser.
      </Note>
    </div>
  );
}

function AgentDetail({ agent }: { agent: AgentCard }) {
  const owner = OWNER_KIND_META[agent.ownerKind];
  return (
    <Card icon="document" title="Agent card" subtitle={agent.name}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="brand">v{agent.version}</Badge>
        <Badge variant={owner.variant}>{owner.label}</Badge>
        <HealthBadge health={agent.health} />
      </div>

      <p className={cx("mt-3", type_.body)}>{agent.purpose}</p>

      <dl className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Owner">{agent.owner}</Field>
        <Field label="Identity">
          <Mono>{agent.identity}</Mono>
        </Field>
        <Field label="Endpoint">
          <Mono className="break-all">{agent.endpoint}</Mono>
        </Field>
        <Field label="Registered">{agent.registeredOn}</Field>
      </dl>

      <div className="mt-4">
        <p className={cx("flex items-center gap-1.5", type_.label)}>
          <Icon name="settings" size={13} />
          Tools
        </p>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {agent.tools.map((tool) => (
            <li
              key={tool}
              className="rounded-full border border-line-strong bg-surface-soft px-2.5 py-1 font-mono text-[11px] text-ink-soft"
            >
              {tool}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4 grid gap-3">
        <div className="rounded-control border border-brand/20 bg-brand-soft px-3.5 py-3">
          <p className="flex items-center gap-1.5 text-[11px] font-medium tracking-[0.08em] text-brand-deep uppercase">
            <Icon name="check" size={13} />
            In scope
          </p>
          <ul className="mt-2 space-y-1">
            {agent.dataScopes.map((scope) => (
              <li key={scope}>
                <Mono className="text-ink">{scope}</Mono>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-control border border-danger/20 bg-danger-soft px-3.5 py-3">
          <p className="flex items-center gap-1.5 text-[11px] font-medium tracking-[0.08em] text-danger uppercase">
            <Icon name="close" size={13} />
            Denied by card
          </p>
          <ul className="mt-2 space-y-1">
            {agent.deniedScopes.map((scope) => (
              <li key={scope}>
                <Mono className="line-through decoration-danger/40">{scope}</Mono>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}
