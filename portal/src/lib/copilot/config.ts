export const CASERELAY_AGENT_ID = "caserelay_continuity";

export const COPILOT_RUNTIME_URL = "/api/copilotkit";

export const ADK_AGENT_URL = process.env.NEXT_PUBLIC_ADK_AGENT_URL ?? "";

export const isAdkConnected = ADK_AGENT_URL.length > 0;

/**
 * True when the AG-UI agent backend is configured. Without it the chat
 * surface shows a disabled indicator.
 */
export const isRuntimeAvailable = isAdkConnected;
