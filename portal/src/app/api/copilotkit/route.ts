import { HttpAgent } from "@ag-ui/client";
import {
  BuiltInAgent,
  CopilotRuntime,
  InMemoryAgentRunner,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { ADK_AGENT_URL, CASERELAY_AGENT_ID, COPILOT_RUNTIME_URL } from "@/lib/copilot/config";

/**
 * Bridge between the CopilotKit frontend and the agent backend.
 *
 * Two modes, checked in priority order:
 *
 *   1. ADK — `NEXT_PUBLIC_ADK_AGENT_URL` points at the Google ADK agent.
 *      `HttpAgent` speaks AG-UI over HTTP. This is the primary path: the
 *      fleet's nine Gemini-powered agents run on Vertex AI reasoning engines.
 *
 *   2. Built-in Gemini — `GOOGLE_API_KEY` is set. A `BuiltInAgent` backed by
 *      `gemini-3.5-flash` runs in-process. Frontend tools registered on the
 *      admin page give it the ability to create cases and submit runs.
 *
 * Without either, returns 503 and the client falls back to the in-browser
 * preview agent.
 */
export const dynamic = "force-dynamic";

const GOOGLE_KEY = process.env.GOOGLE_API_KEY ?? "";

const SYSTEM_PROMPT = `You are the CaseRelay assistant, an operator-facing copilot for a child-welfare coordination platform.

You help operators create test cases from scenarios, run the specialist agent fleet, and monitor run events. You do this exclusively through the tools available to you — never fabricate a case ID, run ID, or status.

Rules:
- When the user asks to create a case, call the create_case tool. Always confirm the result with the real case_id returned.
- When the user asks to run the fleet (or "run it", "run maya's case", etc.), call the run_fleet tool with the appropriate case_id. If ambiguous, check session_state context for the most recent case.
- When the user asks what scenarios are available, call the list_scenarios tool.
- Never invent data. If a tool call fails, report the error honestly.
- Keep responses concise and operational.`;

function buildHandler() {
  if (ADK_AGENT_URL) {
    return createCopilotRuntimeHandler({
      runtime: new CopilotRuntime({
        agents: {
          [CASERELAY_AGENT_ID]: new HttpAgent({ url: ADK_AGENT_URL }),
        },
      }),
      basePath: COPILOT_RUNTIME_URL,
    });
  }

  if (GOOGLE_KEY) {
    return createCopilotRuntimeHandler({
      runtime: new CopilotRuntime({
        agents: {
          [CASERELAY_AGENT_ID]: new BuiltInAgent({
            model: "google:gemini-3.5-flash",
            prompt: SYSTEM_PROMPT,
          }),
        },
        runner: new InMemoryAgentRunner(),
      }),
      basePath: COPILOT_RUNTIME_URL,
    });
  }

  return null;
}

const handler = buildHandler();

function notConfigured() {
  return Response.json(
    {
      error: "No agent backend configured.",
      detail:
        "Set NEXT_PUBLIC_ADK_AGENT_URL to the ADK agent's AG-UI endpoint (preferred), " +
        "or GOOGLE_API_KEY for a built-in Gemini-backed fallback. " +
        "Without either, the portal uses the in-browser preview agent.",
    },
    { status: 503 },
  );
}

export async function POST(request: Request) {
  return handler ? handler(request) : notConfigured();
}

export async function GET(request: Request) {
  return handler ? handler(request) : notConfigured();
}
