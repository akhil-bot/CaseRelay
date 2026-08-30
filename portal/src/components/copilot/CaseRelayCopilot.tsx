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
 * ── The slots, held still ────────────────────────────────────────────────────
 *
 * Every one of these is a constant, and they are out here rather than inline on
 * the element because their identity is load-bearing.
 *
 * CopilotKit memoises each message individually and compares the slot props it
 * was given by reference — `if (prevProps.slotProps !== nextProps.slotProps)
 * return false`, in both the assistant and user message wrappers. Written as
 * literals in the render, they are new objects every time, so that comparison
 * never holds and every message in the thread re-renders whenever anything
 * re-renders the panel.
 *
 * Which is often: the component below reads the caseload, the approvals queue
 * and the scenario clock, and the approvals poll alone re-renders it every
 * fifteen seconds. The cost of that grows with the length of the conversation,
 * so the longer someone talks to the assistant the worse it gets.
 *
 * Nothing in here closes over a prop or a hook, so module scope is the honest
 * place for them: they are describing which components fill which slot, and
 * that answer never changes.
 */
/**
 * How wide the panel opens, in px.
 *
 * The thread is not only prose: it carries the widgets in `chat-widgets.tsx`,
 * and a court report's decision log, which is a four-column table. At 492 those
 * were the things that suffered first — facts truncating mid-word, a name and a
 * date on a chip wrapping to two lines.
 *
 * Only ever a desktop measurement. Below 768px CopilotKit gives the panel the
 * full viewport and stops pushing the body aside, so a wider number here cannot
 * crowd a phone. On desktop it does come out of the page behind it, which is why
 * this is a modest step rather than as wide as the content would like.
 */
const PANEL_WIDTH = 560;

const HEADER = { closeButton: ChatCloseButton, children: ChatHeader } as const;

const TOGGLE_BUTTON = { openIcon: ToggleOpenIcon, closeIcon: ToggleCloseIcon } as const;

const MESSAGE_VIEW = {
  assistantMessage: AssistantMessage,
  intelligenceIndicator: Hidden,
  // The user-message toolbar is only a copy button, and it ships
  // `invisible group-hover:visible` — which still reserves its 36px
  // under every question the volunteer asks. Dropping the slot reclaims
  // the space instead of styling around a control we do not offer.
  userMessage: { toolbar: Hidden },
} as const;

const INPUT = {
  className: "caserelay-chat-input",
  addMenuButton: Hidden,
  startTranscribeButton: Hidden,
  showDisclaimer: false,
} as const;

const LABELS = {
  chatInputPlaceholder: "Ask about a case, a deadline, or who owns a step",
  welcomeMessageText: "I can help you follow commitments, deadlines, and handoffs.",
} as const;

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
        width={PANEL_WIDTH}
        header={HEADER}
        toggleButton={TOGGLE_BUTTON}
        messageView={MESSAGE_VIEW}
        input={INPUT}
        labels={LABELS}
      />

      <ConversationBridge />
    </>
  );
}
