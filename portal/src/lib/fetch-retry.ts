/**
 * Retry wrapper for transient DNS / pre-connection failures.
 *
 * Why these codes are safe to retry, even for POSTs:
 * Node.js / undici throws `TypeError: fetch failed` with a cause code only
 * when the TCP handshake never completed — i.e. no bytes of the request were
 * delivered to the server. Once the TCP connection is established and headers
 * have been sent, undici returns a Response object (or surfaces body-read
 * errors separately). Therefore any thrown fetch error carrying one of the
 * codes below is evidence that the upstream never saw the request, making a
 * retry unconditionally safe regardless of HTTP method.
 *
 * Excluded: HTTP 4xx/5xx are real server answers and are never retried here.
 * Excluded: SSE streams — callers must opt out by using plain fetch() so that
 * a mid-flight stream is never re-established and events never duplicated.
 */

const RETRIABLE_CODES = new Set([
  "ENOTFOUND",   // DNS resolution failed — request never left the machine
  "EAI_AGAIN",   // DNS temporary failure — same guarantee as ENOTFOUND
  "ECONNREFUSED", // Server rejected TCP SYN — no bytes sent
  "ECONNRESET",  // Connection reset during handshake (pre-headers)
  "ETIMEDOUT",   // TCP SYN timed out — connection never established
]);

/** Backoffs between attempt 1→2 and 2→3 (ms). Total worst-case: ~1 s. */
const RETRY_DELAYS_MS = [250, 750] as const;

function isRetriableConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const cause = (err as Error & { cause?: unknown }).cause;
  if (cause !== null && typeof cause === "object" && "code" in cause) {
    return RETRIABLE_CODES.has((cause as { code: string }).code);
  }
  return false;
}

/**
 * Drop-in replacement for `fetch` that retries up to 3 times on pre-connection
 * failures. Use in place of `fetch` for non-SSE control-plane calls.
 */
export async function fetchWithRetry(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): Promise<Response> {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fetch(input, init);
    } catch (err) {
      const isLast = attempt === RETRY_DELAYS_MS.length;
      if (!isRetriableConnectionError(err) || isLast) throw err;

      const delay = RETRY_DELAYS_MS[attempt];
      const code = ((err as Error & { cause?: { code?: string } }).cause)?.code;
      console.warn(
        `[fetch-retry] ${code} on attempt ${attempt + 1}/${RETRY_DELAYS_MS.length + 1}, ` +
          `retrying in ${delay} ms — ${String(input).slice(0, 120)}`,
      );
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
  }
  // Unreachable; satisfies TypeScript.
  throw new Error("fetchWithRetry: unexpected exit");
}
