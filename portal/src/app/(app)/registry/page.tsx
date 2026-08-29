"use client";

import { useCallback, useMemo, useState } from "react";
import { Icon, type IconName } from "@/components/icons";
import {
  Badge,
  Card,
  EmptyState,
  Field,
  Group,
  HealthBadge,
  Loading,
  Mono,
  Rows,
  cx,
} from "@/components/ui/primitives";
import { control, layout, row, surface, tone, type as type_, type Tone } from "@/design/tokens";
import { listRegistry, type AgentCardRecord } from "@/lib/api";
import { usePolled } from "@/lib/use-polled";
import type { Health } from "@/lib/types";

/**
 * The agent registry, read from the control plane.
 *
 * These are the same cards the orchestrator discovers against — not a copy kept
 * in the portal, which could describe a fleet that no longer exists.
 */
const OWNER_FILTERS = [
  { id: "all", label: "All owners", icon: "agents" as IconName },
  { id: "casa", label: "CASA program", icon: "home" as IconName },
  { id: "partner", label: "Partner organizations", icon: "users" as IconName },
  { id: "compliance", label: "Compliance", icon: "shield" as IconName },
] as const;

type OwnerKind = "casa" | "partner" | "compliance";

const OWNER_KIND_META: Record<OwnerKind, { label: string; variant: Tone }> = {
  casa: { label: "CASA program", variant: "brand" },
  partner: { label: "Partner org", variant: "neutral" },
  compliance: { label: "Compliance", variant: "warn" },
};

/**
 * A card names the organization that owns it but not what kind of organization
 * it is, and the filter needs the kind. The program runs its own agents and its
 * compliance agent; everything else answers to somebody else.
 */
function ownerKind(ownerOrg: string): OwnerKind {
  const org = ownerOrg.toLowerCase();
  if (org.includes("compliance")) return "compliance";
  if (org.includes("casa")) return "casa";
  return "partner";
}

const KNOWN_HEALTH: Health[] = ["healthy", "degraded", "unverified"];

const POLL_INTERVAL = 30_000;

export default function AgentsPage() {
  const load = useCallback(() => listRegistry(), []);
  const [registry, refresh] = usePolled(load, POLL_INTERVAL);

  const [filter, setFilter] = useState<(typeof OWNER_FILTERS)[number]["id"]>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const agents = useMemo(
    () => (registry.status === "loaded" ? registry.data : []),
    [registry],
  );

  const visible = useMemo(
    () =>
      filter === "all" ? agents : agents.filter((agent) => ownerKind(agent.owner_org) === filter),
    [agents, filter],
  );

  // The selection follows the list rather than being pinned to it: filtering
  // away the open card should show another, not an empty panel.
  const selected = agents.find((agent) => agent.agent_id === selectedId) ?? visible[0] ?? null;

  if (registry.status === "loading") {
    return (
      <Card
        icon="registry"
        title="Agent registry"
        fill
        className={layout.fillHeight}
        bodyClassName="flex flex-col justify-center"
      >
        <Loading icon="agents" title="Reading the registry…" hint="Which agents are callable, and what each may see." />
      </Card>
    );
  }

  if (registry.status === "error") {
    return (
      <Card icon="alert" title="Control plane error">
        <div className="flex items-start gap-3 rounded-control border border-danger/25 bg-danger/5 px-4 py-3">
          <Icon name="alert" size={18} className="mt-0.5 shrink-0 text-danger" />
          <div>
            <p className="text-[13px] font-medium text-danger">Couldn&apos;t read the registry</p>
            <p className={cx("mt-1", type_.small)}>{registry.message}</p>
          </div>
        </div>
        <div className="mt-4">
          <button type="button" onClick={refresh} className={control.secondary}>
            <Icon name="retry" size={15} />
            Try again
          </button>
        </div>
      </Card>
    );
  }

  const owners = new Set(agents.map((agent) => agent.owner_org));

  return (
    <div className={layout.stack}>
      <section className={cx(surface.card, "px-4 py-4")}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className={type_.sectionTitle}>
              {agents.length} agents, {owners.size} owners, {agents.length} identities
            </p>
            <p className={cx("mt-1", layout.measure, type_.small)}>
              Discovery is how the Orchestrator finds a partner. It never hardcodes one.
            </p>
          </div>
          <button type="button" onClick={refresh} className={control.secondary}>
            <Icon name="retry" size={15} />
            Refresh
          </button>
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
          flush={visible.length > 0}
        >
          {visible.length === 0 ? (
            <EmptyState
              icon="search"
              title={
                agents.length === 0
                  ? "The registry is serving no agent cards."
                  : "No agent has that owner."
              }
              hint={
                agents.length === 0
                  ? "Nothing can be discovered until at least one card is registered."
                  : undefined
              }
            />
          ) : (
            <Rows>
              {visible.map((agent) => {
                const owner = OWNER_KIND_META[ownerKind(agent.owner_org)];
                const active = agent.agent_id === selected?.agent_id;
                return (
                  <li key={agent.agent_id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(agent.agent_id)}
                      aria-pressed={active}
                      className={cx("w-full text-left", row.pad, active ? row.selected : row.hover)}
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
                        <span className="text-[13.5px] font-semibold text-ink">
                          {agent.display_name}
                        </span>
                        <Badge variant="neutral">v{agent.version}</Badge>
                        <span className="ml-auto">
                          <AgentHealth status={agent.health_status} />
                        </span>
                      </div>
                      <p className={cx("mt-1.5", type_.meta)}>{agent.owner_org}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-muted">
                        <Mono className="text-[11px]">{agent.identity}</Mono>
                        <span className="flex items-center gap-1">
                          <Icon name="settings" size={12} />
                          {agent.tools.length} tools
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </Rows>
          )}
        </Card>

        {selected && <AgentDetail agent={selected} />}
      </div>
    </div>
  );
}

/** The card reports its own health; anything the UI does not recognise is shown as-is. */
function AgentHealth({ status }: { status: string }) {
  if ((KNOWN_HEALTH as string[]).includes(status)) {
    return <HealthBadge health={status as Health} />;
  }
  return <Badge variant="neutral">{status}</Badge>;
}

function AgentDetail({ agent }: { agent: AgentCardRecord }) {
  const owner = OWNER_KIND_META[ownerKind(agent.owner_org)];
  return (
    <Card icon="document" title="Agent card" subtitle={agent.display_name}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="brand">v{agent.version}</Badge>
        <Badge variant={owner.variant}>{owner.label}</Badge>
        <AgentHealth status={agent.health_status} />
      </div>

      <p className={cx("mt-3", type_.body)}>{agent.purpose}</p>

      <dl className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Owner">{agent.owner_org}</Field>
        <Field label="Agent ID">
          <Mono>{agent.agent_id}</Mono>
        </Field>
        <Field label="Identity">
          <Mono className="break-all">{agent.identity}</Mono>
        </Field>
        <Field label="Tools">{agent.tools.length}</Field>
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

      <div className="mt-5 grid gap-5">
        <Group variant="brand" icon="check" label="In scope">
          <ul className="space-y-1">
            {agent.allowed_data_scopes.map((scope) => (
              <li key={scope}>
                <Mono className="text-ink">{scope}</Mono>
              </li>
            ))}
          </ul>
        </Group>
        <Group variant="danger" icon="close" label="Denied by card">
          <ul className="space-y-1">
            {agent.denied_data_scopes.map((scope) => (
              <li key={scope}>
                <Mono className="line-through decoration-danger/40">{scope}</Mono>
              </li>
            ))}
          </ul>
        </Group>
      </div>
    </Card>
  );
}
