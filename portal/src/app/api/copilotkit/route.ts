import { HttpAgent } from "@ag-ui/client";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { controlPlaneAuthHeaders } from "@/lib/control-plane-token";
import { CASERELAY_AGENT_ID, COPILOT_RUNTIME_URL } from "@/lib/copilot/config";
import { fetchWithRetry } from "@/lib/fetch-retry";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function buildHandler() {
  const base = process.env.CONTROL_PLANE_URL;
  if (!base) return null;

  const agentUrl = `${base}/agui/`;

  // fetchWithRetry retries only when fetch() throws with a pre-connection error
  // code, meaning no bytes reached the agent server. Safe for POST because
  // undici only throws (vs. returning a Response) before the TCP handshake
  // completes. If the AG-UI stream dies mid-flight, fetch() returns normally
  // and the body-read error is handled by the CopilotKit runtime — not here.
  const authenticatedFetch: typeof globalThis.fetch = async (input, init) => {
    const auth = await controlPlaneAuthHeaders();
    const existing = new Headers(init?.headers);
    for (const [k, v] of Object.entries(auth)) existing.set(k, v);
    return fetchWithRetry(input, { ...init, headers: existing });
  };

  return createCopilotRuntimeHandler({
    runtime: new CopilotRuntime({
      agents: {
        [CASERELAY_AGENT_ID]: new HttpAgent({
          url: agentUrl,
          fetch: authenticatedFetch,
        }),
      },
    }),
    basePath: COPILOT_RUNTIME_URL,
    mode: "single-route",
  });
}

const handler = buildHandler();

function notConfigured() {
  return Response.json(
    {
      error: "No agent backend configured.",
      detail:
        "Set CONTROL_PLANE_URL to the control plane's base URL.",
    },
    { status: 503 },
  );
}

export async function POST(request: Request) {
  if (!handler) return notConfigured();
  return handler(request);
}

export async function GET(request: Request) {
  return handler ? handler(request) : notConfigured();
}
