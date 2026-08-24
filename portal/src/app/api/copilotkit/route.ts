import { HttpAgent } from "@ag-ui/client";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { ADK_AGENT_URL, CASERELAY_AGENT_ID, COPILOT_RUNTIME_URL } from "@/lib/copilot/config";

export const dynamic = "force-dynamic";

function buildHandler() {
  if (!ADK_AGENT_URL) return null;

  return createCopilotRuntimeHandler({
    runtime: new CopilotRuntime({
      agents: {
        [CASERELAY_AGENT_ID]: new HttpAgent({ url: ADK_AGENT_URL }),
      },
    }),
    basePath: COPILOT_RUNTIME_URL,
  });
}

const handler = buildHandler();

function notConfigured() {
  return Response.json(
    {
      error: "No agent backend configured.",
      detail:
        "Set NEXT_PUBLIC_ADK_AGENT_URL to the control plane's /agui endpoint.",
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
