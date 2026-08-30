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
import { fetchWithRetry } from "@/lib/fetch-retry";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

    const isSSE = req.headers.get("accept")?.includes("text/event-stream");

    // SSE streams last as long as the orchestrator run (~5-10 min).
    // Non-SSE calls should also carry an explicit signal: without one,
    // undici's internal socket timeout fires as an opaque
    // "TypeError: fetch failed", indistinguishable from a DNS error.
    const signal = isSSE
      ? AbortSignal.timeout(30 * 60_000)
      : AbortSignal.timeout(30_000);

    // SSE streams are excluded from retry: a mid-flight stream has already
    // delivered events, and re-establishing it would duplicate them.
    // fetchWithRetry is safe for non-SSE because it only retries when fetch()
    // throws (TCP handshake never completed — no bytes reached the server).
    const doFetch = isSSE ? fetch : fetchWithRetry;

    const upstreamRes = await doFetch(target.toString(), {
      method: req.method,
      headers,
      body: bodyText,
      cache: "no-store",
      signal,
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

    const headersOut: Record<string, string> = {
      "Content-Type":
        upstreamRes.headers.get("content-type") || "application/json",
    };

    // Paged routes report the size of the whole set in a header, and the body
    // they return is deliberately just the page. Dropping this is what turns a
    // paginated endpoint back into one the caller has to read to the end.
    const total = upstreamRes.headers.get("x-total-count");
    if (total) headersOut["X-Total-Count"] = total;

    return new Response(await upstreamRes.text(), {
      status: upstreamRes.status,
      headers: headersOut,
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
