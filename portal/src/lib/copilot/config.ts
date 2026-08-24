/**
 * CopilotKit talks to the CaseRelay agent over AG-UI. Three wirings exist:
 *
 *   ADK — `NEXT_PUBLIC_ADK_AGENT_URL` points at the ADK agent's AG-UI endpoint.
 *     The browser posts to /api/copilotkit, which forwards there. This is the
 *     primary path: all nine fleet agents run Gemini on Vertex AI.
 *
 *   Built-in Gemini — `GOOGLE_API_KEY` is set server-side. The runtime route
 *     runs a BuiltInAgent backed by gemini-3.5-flash. Set
 *     `NEXT_PUBLIC_COPILOT_RUNTIME=true` so the client uses the runtime.
 *
 *   Preview — neither is configured. A scripted agent runs in the browser.
 */
export const CASERELAY_AGENT_ID = "caserelay_continuity";

export const COPILOT_RUNTIME_URL = "/api/copilotkit";

export const ADK_AGENT_URL = process.env.NEXT_PUBLIC_ADK_AGENT_URL ?? "";

export const isAdkConnected = ADK_AGENT_URL.length > 0;

/**
 * True when the server-side runtime is expected to be functional — either the
 * ADK agent is configured, or `NEXT_PUBLIC_COPILOT_RUNTIME=true` signals that
 * the built-in Gemini agent is available (backed by GOOGLE_API_KEY on the server).
 */
export const isRuntimeAvailable =
  isAdkConnected || process.env.NEXT_PUBLIC_COPILOT_RUNTIME === "true";
