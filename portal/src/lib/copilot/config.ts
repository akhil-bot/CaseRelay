export const CASERELAY_AGENT_ID = "caserelay_continuity";

export const COPILOT_RUNTIME_URL = "/api/copilotkit";

export const isAdkConnected = process.env.NEXT_PUBLIC_COPILOT_ENABLED === "true";

export const isRuntimeAvailable = isAdkConnected;
