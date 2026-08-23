import { HttpAgent } from "@ag-ui/client";
import { CopilotRuntime, createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";
import { ADK_AGENT_URL, CASERELAY_AGENT_ID, COPILOT_RUNTIME_URL } from "@/lib/copilot/config";

/**
 * Bridge between the CopilotKit frontend and the Google ADK agent.
 *
 * `HttpAgent` speaks AG-UI over HTTP, which is what the `ag_ui_adk` `ADKAgent`
 * middleware exposes on the Python side. Nothing here is ADK-specific beyond
 * the URL: any AG-UI compatible endpoint works.
 *
 * Without `NEXT_PUBLIC_ADK_AGENT_URL` the prototype runs a scripted agent in the
 * browser instead, so this route answers 503 rather than proxying to a host that
 * is not there.
 */
export const dynamic = "force-dynamic";

const handler = ADK_AGENT_URL
  ? createCopilotRuntimeHandler({
      runtime: new CopilotRuntime({
        agents: {
          [CASERELAY_AGENT_ID]: new HttpAgent({ url: ADK_AGENT_URL }),
        },
      }),
      basePath: COPILOT_RUNTIME_URL,
    })
  : null;

function notConfigured() {
  return Response.json(
    {
      error: "No ADK agent configured.",
      detail:
        "Set NEXT_PUBLIC_ADK_AGENT_URL to the AG-UI endpoint exposed by the ADK backend. Until then the portal uses its in-browser preview agent.",
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
