"use client";

import { CopilotChatConfigurationProvider, CopilotKit } from "@copilotkit/react-core/v2";
import { useMemo, type ReactNode } from "react";
import { CASERELAY_AGENT_ID, COPILOT_RUNTIME_URL, isAdkConnected } from "@/lib/copilot/config";
import { ConversationsProvider } from "@/lib/copilot/conversations";
import { CaseRelayPreviewAgent } from "@/lib/copilot/preview-agent";

/**
 * When the ADK backend is configured the provider points at the runtime route,
 * which forwards to the agent over AG-UI. Otherwise the scripted agent is handed
 * to the provider directly and no network call is made at all.
 */
export function CopilotProvider({ children }: { children: ReactNode }) {
  const selfManagedAgents = useMemo(
    () => (isAdkConnected ? undefined : { [CASERELAY_AGENT_ID]: new CaseRelayPreviewAgent() }),
    [],
  );

  return (
    // Seeds the panel closed, and has to sit above `CopilotKit` to do it.
    //
    // `CopilotKit` mounts a chat configuration provider of its own with no
    // default, so it starts open, and every descendant provider — including the
    // one carrying the sidebar's `defaultOpen={false}` — syncs itself to that
    // ancestor on its second effect run. StrictMode's double invocation is
    // enough to trigger the sync, so the panel loaded open in development and
    // closed in production. The root resolves its own state straight from its
    // parent rather than through that sync, so one provider above it settles the
    // whole chain, both environments alike.
    <CopilotChatConfigurationProvider isModalDefaultOpen={false}>
      <CopilotKit
        runtimeUrl={isAdkConnected ? COPILOT_RUNTIME_URL : undefined}
        selfManagedAgents={selfManagedAgents}
        // Both default to on when the app is served from localhost, which puts a
        // second floating button next to the chat launcher — the AG-UI event
        // inspector, plus CopilotKit's own error toasts and usage banner. They
        // are the vendor's debug surface, not part of this product.
        enableInspector={false}
        showDevConsole={false}
      >
        {/* Inside `CopilotKit`, because the panel reads the active thread off the
            chat configuration the provider above mounts. */}
        <ConversationsProvider>{children}</ConversationsProvider>
      </CopilotKit>
    </CopilotChatConfigurationProvider>
  );
}
