"use client";

import { CopilotChatConfigurationProvider, CopilotKit } from "@copilotkit/react-core/v2";
import { useMemo, type ReactNode } from "react";
import {
  CASERELAY_AGENT_ID,
  COPILOT_RUNTIME_URL,
  isRuntimeAvailable,
} from "@/lib/copilot/config";
import { ConversationsProvider } from "@/lib/copilot/conversations";
import { CaseRelayPreviewAgent } from "@/lib/copilot/preview-agent";

/**
 * When the runtime is available (ADK or built-in Gemini agent) the provider
 * points at the runtime route. Otherwise the scripted preview agent handles
 * everything in-browser with no network call.
 */
export function CopilotProvider({ children }: { children: ReactNode }) {
  const selfManagedAgents = useMemo(
    () => (isRuntimeAvailable ? undefined : { [CASERELAY_AGENT_ID]: new CaseRelayPreviewAgent() }),
    [],
  );

  return (
    <CopilotChatConfigurationProvider isModalDefaultOpen={false}>
      <CopilotKit
        runtimeUrl={isRuntimeAvailable ? COPILOT_RUNTIME_URL : undefined}
        selfManagedAgents={selfManagedAgents}
        enableInspector={false}
        showDevConsole={false}
      >
        <ConversationsProvider>{children}</ConversationsProvider>
      </CopilotKit>
    </CopilotChatConfigurationProvider>
  );
}
