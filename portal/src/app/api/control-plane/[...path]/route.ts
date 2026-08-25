/**
 * BFF proxy for the CaseRelay control plane.
 *
 * Every request is forwarded to the Cloud Run service with a Google-signed
 * ID token attached server-side. For SSE endpoints (text/event-stream), the
 * upstream body is piped through without buffering so events arrive
 * incrementally.
 *
 * No credential is exposed to the client — the browser calls this same-origin
 * route, and only the Next.js server holds the token.
 */

import { type NextRequest } from "next/server";
import {
  controlPlaneAuthHeaders,
  controlPlaneUrl,
} from "@/lib/control-plane-token";

export const dynamic = "force-dynamic";

async function proxy(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path } = await context.params;
    const upstream = controlPlaneUrl();
    const target = new URL("/" + path.join("/"), upstream);

    req.nextUrl.searchParams.forEach((v, k) => target.searchParams.set(k, v));

    const authHeaders = await controlPlaneAuthHeaders();

    const headers: Record<string, string> = { ...authHeaders };
    const ct = req.headers.get("content-type");
    if (ct) headers["Content-Type"] = ct;

    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const bodyText = hasBody ? await req.text() : undefined;

    const upstreamRes = await fetch(target.toString(), {
      method: req.method,
      headers,
      body: bodyText,
      cache: "no-store",
    });

    if (
      upstreamRes.headers.get("content-type")?.includes("text/event-stream")
    ) {
      return new Response(upstreamRes.body, {
        status: upstreamRes.status,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }

    return new Response(await upstreamRes.text(), {
      status: upstreamRes.status,
      headers: {
        "Content-Type":
          upstreamRes.headers.get("content-type") || "application/json",
      },
    });
  } catch (err) {
    return Response.json(
      { error: "Proxy error", detail: String(err) },
      { status: 502 },
    );
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const DELETE = proxy;
export const PATCH = proxy;
