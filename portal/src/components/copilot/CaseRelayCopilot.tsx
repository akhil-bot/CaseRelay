"use client";

import { CopilotSidebar, useAgentContext } from "@copilotkit/react-core/v2";
import { usePathname } from "next/navigation";
import {
  AssistantMessage,
  ChatCloseButton,
  ChatHeader,
  Hidden,
  ToggleCloseIcon,
  ToggleOpenIcon,
} from "@/components/copilot/chat-parts";
import { ConversationBridge } from "@/components/copilot/conversation-history";
import { LogoMark } from "@/components/Logo";
import { cx } from "@/design/tokens";
import { CASERELAY_AGENT_ID, isRuntimeAvailable } from "@/lib/copilot/config";
import { useToolEvents } from "@/lib/copilot/tool-events";
import { useDemo } from "@/lib/demo-store";
import { useLiveApprovals } from "@/lib/live-approvals";
import { useViewer } from "@/lib/viewer";

/**
 * Entry point: renders the connected chat when an agent is configured, or a
 * calm disabled indicator when the copilot runtime is not enabled.
 */
export function CaseRelayCopilot() {
  if (!isRuntimeAvailable) return <UnconfiguredChat />;
  return <ConnectedChat />;
}

/**
 * Floating toggle that communicates "chat is unavailable" and names the two
 * environment variables that enable it. Hovering the dimmed mark surfaces
 * the setup instructions without cluttering the page at rest.
 */
function UnconfiguredChat() {
  return (
    <div className="group fixed right-5 bottom-5 z-50">
      <button
        type="button"
        disabled
        aria-label="Chat unavailable — no agent configured"
        className={cx(
          "flex size-12 cursor-not-allowed items-center justify-center rounded-full",
          "border border-line bg-surface opacity-40 shadow-card",
        )}
      >
        <LogoMark size={26} />
      </button>

      <div
        className={cx(
          "pointer-events-none absolute right-0 bottom-full mb-2 w-72",
          "rounded-card border border-line bg-surface p-3 shadow-pop",
          "opacity-0 transition-opacity group-hover:opacity-100",
        )}
      >
        <p className="text-[12.5px] font-medium text-ink">Chat unavailable</p>
        <p className="mt-1 text-[11.5px] leading-relaxed text-ink-muted">
          Set{" "}
          <code className="font-mono text-[10.5px]">CONTROL_PLANE_URL</code>{" "}
          and <code className="font-mono text-[10.5px]">NEXT_PUBLIC_COPILOT_ENABLED=true</code>.
        </p>
      </div>
    </div>
  );
}

/**
 * The chat surface, plus the context the agent is allowed to see.
 *
 * `useAgentContext` is a one-way channel: the agent reads what the person is
 * currently looking at, so "what is overdue here" resolves without them
 * restating it. Only operational facts cross it — counts, flags, deadlines —
 * never the narrative detail of a child's record.
 */
function ConnectedChat() {
  const pathname = usePathname() ?? "/";
  const { profile } = useViewer();
  const { cases, meta } = useDemo();
  const { gates } = useLiveApprovals();
  const { caseEntries } = useToolEvents();

  const overdue = cases.filter((item) => item.flags.includes("overdue")).length;
  const blocked = cases.filter((item) => item.flags.includes("blocked")).length;

  const caseRegistryValue =
    caseEntries.length === 0
      ? "No cases opened in this conversation yet."
      : caseEntries.map((e) => `${e.childName} → ${e.caseId}`).join("; ");

  useAgentContext({
    description: "Current view and signed-in role",
    value: `${profile.name}, ${profile.role}. Currently on ${pathname}.`,
  });

  useAgentContext({
    description: "Caseload summary",
    value: `${cases.length} cases: ${overdue} overdue, ${blocked} blocked, ${gates.length} awaiting human approval.`,
  });

  useAgentContext({
    description: "Where the caseload stands on the timeline today",
    value: `${meta.dayLabel} — ${meta.label}. ${meta.narration}`,
  });

  useAgentContext({
    description: "Cases opened in this conversation — child's name to case ID, for resolving who 'it' refers to",
    value: caseRegistryValue,
  });

  return (
    <>
      <CopilotSidebar
        agentId={CASERELAY_AGENT_ID}
        defaultOpen={false}
        width={492}
        header={{ closeButton: ChatCloseButton, children: ChatHeader }}
        toggleButton={{ openIcon: ToggleOpenIcon, closeIcon: ToggleCloseIcon }}
        messageView={{
          assistantMessage: AssistantMessage,
          intelligenceIndicator: Hidden,
          // The user-message toolbar is only a copy button, and it ships
          // `invisible group-hover:visible` — which still reserves its 36px
          // under every question the volunteer asks. Dropping the slot reclaims
          // the space instead of styling around a control we do not offer.
          userMessage: { toolbar: Hidden },
        }}
        input={{
          className: "caserelay-chat-input",
          addMenuButton: Hidden,
          startTranscribeButton: Hidden,
          showDisclaimer: false,
        }}
        labels={{
            chatInputPlaceholder: "Ask about a case, a deadline, or who owns a step",
            welcomeMessageText: "I can help you follow commitments, deadlines, and handoffs.",
          }}
      />

      <ConversationBridge />
    </>
  );
}
