/**
 * ── Who is signed in ─────────────────────────────────────────────────────────
 *
 * The role is chosen at sign-in and decides the whole shape of the product: the
 * sidebar, whose name is written to a decision, and which screens exist.
 *
 * It lives on <html> rather than in React state alone. An inline script applies
 * it while the HTML is still being parsed and CSS does the hiding, so a sidebar
 * never paints one role's items and swaps them for another's once React
 * hydrates. Filtering the list in the component cannot avoid that flash,
 * because the server has no way to read localStorage.
 */

import type { Role } from "@/design/personas";

export const ROLE_KEY = "caserelay.role";
export const ROLE_ATTR = "data-role";

/**
 * What the server renders and what someone who has never signed in gets. The
 * advocate is the product's centre of gravity, and it is the view that shows
 * the least, so arriving in it can never expose a screen the person should not
 * have reached.
 */
export const DEFAULT_ROLE: Role = "advocate";

const KNOWN: Role[] = ["advocate", "supervisor", "admin"];

function coerce(value: unknown): Role {
  return KNOWN.includes(value as Role) ? (value as Role) : DEFAULT_ROLE;
}

export function readRole(): Role {
  try {
    return coerce(window.localStorage.getItem(ROLE_KEY));
  } catch {
    return DEFAULT_ROLE;
  }
}

export function applyRole(role: Role) {
  document.documentElement.setAttribute(ROLE_ATTR, role);
}

/** Persists and applies in one go, for the sign-in that chose it. */
export function storeRole(role: Role) {
  try {
    window.localStorage.setItem(ROLE_KEY, role);
  } catch {
    // A browser refusing storage still gets the right view for this page load.
  }
  applyRole(role);
}

/** Runs synchronously as the browser parses the document, before the first paint. */
export const ROLE_SCRIPT = `(function(){try{var r=localStorage.getItem(${JSON.stringify(
  ROLE_KEY,
)});document.documentElement.setAttribute(${JSON.stringify(ROLE_ATTR)},${JSON.stringify(
  KNOWN,
)}.indexOf(r)>=0?r:${JSON.stringify(DEFAULT_ROLE)})}catch(e){}})()`;
