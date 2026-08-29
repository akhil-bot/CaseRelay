import type { IconName } from "@/components/icons";
import type { Tone } from "@/design/tokens";
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
