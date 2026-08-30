import { NextResponse, type NextRequest } from "next/server";

/**
 * The gate on the hosted portal.
 *
 * The sign-in screen inside the app is a prototype: it takes any password and
 * writes down which of the three personas you chose (see useSignIn.ts). That is
 * fine on a laptop and not fine on a public URL, because the portal reaches the
 * control plane with its own service account — so anyone who can load a page
 * can read case data through /api/control-plane, whatever the UI shows them.
 *
 * Hence a check in middleware rather than in the app: it is the only thing that
 * runs in front of the route handlers as well as the pages. HTTP Basic is what
 * is wanted here — one shared credential, held by the browser, with no session
 * store, no cookie to forge and nothing to reset if it leaks beyond changing
 * the secret and redeploying.
 */

const REALM = 'Basic realm="CaseRelay", charset="UTF-8"';

function challenge(): NextResponse {
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": REALM,
      // A 401 that gets cached is a portal nobody can sign into.
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Compare through SHA-256 rather than with `===`.
 *
 * String equality returns as soon as two characters differ, so how long it
 * takes to answer says something about how much of the password was right.
 * Hashing first makes every comparison the same length regardless of what was
 * submitted, and the loop below reads all 32 bytes whatever it finds.
 */
async function matches(supplied: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(supplied)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);

  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < left.length; i += 1) difference |= left[i] ^ right[i];
  return difference === 0;
}

/** The `user:password` an Authorization header carries, or null if malformed. */
function credentials(header: string | null): string | null {
  if (!header?.startsWith("Basic ")) return null;

  try {
    // atob yields one char per byte, so the bytes are rebuilt before decoding
    // rather than trusted as text — otherwise a non-ASCII password never matches.
    const bytes = Uint8Array.from(atob(header.slice(6).trim()), (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const password = process.env.PORTAL_AUTH_PASSWORD;
  const user = process.env.PORTAL_AUTH_USER || "admin@caserelay.com";

  if (!password) {
    // Unset on a developer machine means the gate is not wanted, and `npm run
    // dev` should not demand a password nobody set. Unset in a deployed build
    // means the secret failed to mount, and serving the portal wide open is the
    // one outcome worse than serving nothing.
    if (process.env.NODE_ENV !== "production") return NextResponse.next();

    return new NextResponse("The portal is not configured for access.", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const supplied = credentials(request.headers.get("authorization"));
  if (supplied === null) return challenge();
  if (!(await matches(supplied, `${user}:${password}`))) return challenge();

  return NextResponse.next();
}

export const config = {
  // Everything the portal serves except its own build output. Note that this
  // deliberately covers /api — the proxy to the control plane is the route that
  // actually carries case data, so leaving it outside the gate would make the
  // gate decorative.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
