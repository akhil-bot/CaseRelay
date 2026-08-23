/**
 * CopilotKit talks to the CaseRelay agent over AG-UI, the protocol Google ADK
 * speaks through the `ag_ui_adk` middleware. Two wirings exist:
 *
 *   ADK connected — `NEXT_PUBLIC_ADK_AGENT_URL` points at the FastAPI endpoint
 *     that wraps the ADK agent. The browser posts to /api/copilotkit, which
 *     forwards to that endpoint.
 *
 *   Preview — no URL configured. A scripted agent runs in the browser so the
 *     chat surface is usable in the prototype, which has no backend at all.
 *
 * The agent id has to match on both sides: it keys the runtime's agent map and
 * selects the agent the chat component talks to.
 */
export const CASERELAY_AGENT_ID = "caserelay_continuity";

export const COPILOT_RUNTIME_URL = "/api/copilotkit";

/** Set in .env.local once the ADK backend is running. */
export const ADK_AGENT_URL = process.env.NEXT_PUBLIC_ADK_AGENT_URL ?? "";

export const isAdkConnected = ADK_AGENT_URL.length > 0;
