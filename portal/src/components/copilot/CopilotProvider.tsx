"use client";

import { CopilotChatConfigurationProvider, CopilotKit } from "@copilotkit/react-core/v2";
import type { ReactNode } from "react";
import { COPILOT_RUNTIME_URL, isRuntimeAvailable } from "@/lib/copilot/config";
import { ConversationsProvider } from "@/lib/copilot/conversations";

/**
 * Mounts CopilotKit only when the ADK agent backend is configured.
 * When unconfigured, children render without a CopilotKit context and the
 * chat surface shows a calm "unconfigured" indicator instead.
 */
export function CopilotProvider({ children }: { children: ReactNode }) {
  if (!isRuntimeAvailable) return <>{children}</>;

  return (
    <CopilotChatConfigurationProvider isModalDefaultOpen={false}>
      <CopilotKit
        runtimeUrl={COPILOT_RUNTIME_URL}
        useSingleEndpoint
        enableInspector={false}
        showDevConsole={false}
      >
        <ConversationsProvider>{children}</ConversationsProvider>
      </CopilotKit>
    </CopilotChatConfigurationProvider>
  );
}
