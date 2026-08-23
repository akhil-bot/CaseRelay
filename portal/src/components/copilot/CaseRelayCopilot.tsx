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
import { CASERELAY_AGENT_ID } from "@/lib/copilot/config";
import { useDemo } from "@/lib/demo-store";
import { useViewer } from "@/lib/viewer";

/**
 * The chat surface, plus the context the agent is allowed to see.
 *
 * `useAgentContext` is a one-way channel: the agent reads what the person is
 * currently looking at, so "what is overdue here" resolves without them
 * restating it. Only operational facts cross it — counts, flags, deadlines —
 * never the narrative detail of a child's record.
 */
export function CaseRelayCopilot() {
  const pathname = usePathname() ?? "/";
  const { profile, showsTechnical } = useViewer();
  const { cases, pendingApprovals, meta } = useDemo();

  const overdue = cases.filter((item) => item.flags.includes("overdue")).length;
  const blocked = cases.filter((item) => item.flags.includes("blocked")).length;

  useAgentContext({
    description: "Current view and signed-in role",
    value: `${profile.name}, ${profile.role} (${profile.viewLabel} view). Currently on ${pathname}.`,
  });

  useAgentContext({
    description: "Caseload summary",
    value: `${cases.length} cases: ${overdue} overdue, ${blocked} blocked, ${pendingApprovals.length} awaiting human approval.`,
  });

  useAgentContext({
    description: "Scenario clock position",
    value: `${meta.dayLabel} — ${meta.label}. ${meta.narration}`,
  });

  return (
    <>
      <CopilotSidebar
        agentId={CASERELAY_AGENT_ID}
        // Not sufficient on its own: every descendant chat configuration
        // provider syncs itself to the root one, which starts open. The
        // provider seeded above `CopilotKit` in `CopilotProvider` is what makes
        // this hold.
        defaultOpen={false}
        width={492}
        // No `threadId` prop. Passing one makes the thread prop-controlled,
        // which turns `startNewThread` and `setActiveThreadId` into logged
        // no-ops — and those are exactly what the header's controls call.
        //
        // The panel is a reader of the portal, nothing more: no file uploads to
        // land a child's record in a chat log, no microphone, and no CopilotKit
        // branding. What is left is a message list and a text box.
        // `children` takes over the header's layout; `closeButton` is still passed
        // as a slot so the render function receives it with the SDK's own close
        // handler already bound.
        header={{ closeButton: ChatCloseButton, children: ChatHeader }}
        toggleButton={{ openIcon: ToggleOpenIcon, closeIcon: ToggleCloseIcon }}
        messageView={{ assistantMessage: AssistantMessage, intelligenceIndicator: Hidden }}
        input={{
          className: "caserelay-chat-input",
          addMenuButton: Hidden,
          startTranscribeButton: Hidden,
          // The standing limit is the header's job now. Dropping the disclaimer
          // also drops the block below the composer, so the pill sits on the
          // bottom edge of the panel.
          showDisclaimer: false,
        }}
        // No `modalHeaderTitle`: the header renders its own lockup, and the
        // standing "decides nothing" line there covers what the greeting used to
        // repeat, so the welcome text is now capability only.
        labels={{
          chatInputPlaceholder: showsTechnical
            ? "Ask about workflows, identities, or policy decisions"
            : "Ask about a case, a deadline, or who owns a step",
          welcomeMessageText: showsTechnical
            ? "I can trace delegations, identities, and policy outcomes across the fleet."
            : "I can help you follow commitments, deadlines, and handoffs.",
        }}
      />

      {/* After the sidebar, not before: the restore has to win against the
          clear `CopilotChat` runs on a thread change, and effects fire in tree
          order. The bridge defers to a microtask so this ordering is belt and
          braces rather than the whole mechanism. */}
      <ConversationBridge />
    </>
  );
}
