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
 * because the server has no way to read the stored value.
 *
 * ── Why two stores ───────────────────────────────────────────────────────────
 *
 * The chosen view belongs to the tab, not the browser. Someone comparing what
 * an advocate sees against what their supervisor sees does it by duplicating
 * the tab and switching one of them, and a single shared value turns that into
 * two windows showing the same thing.
 *
 * So the live answer is in sessionStorage, which is per-tab and which browsers
 * copy into a duplicated tab — the copy therefore opens on the view it was
 * duplicated from and then goes its own way.
 *
 * localStorage keeps the same value only as the starting point for a tab that
 * has no session of its own: opening the app in a fresh tab should not throw
 * away the role that was signed in with. It is never read once the tab has
 * answered for itself, and writing it never disturbs a tab already open.
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

function known(value: unknown): value is Role {
  return KNOWN.includes(value as Role);
}

/** This tab's view, falling back to the one this browser last chose. */
export function readRole(): Role {
  try {
    const session = window.sessionStorage.getItem(ROLE_KEY);
    if (known(session)) return session;
    const seed = window.localStorage.getItem(ROLE_KEY);
    if (known(seed)) return seed;
  } catch {
    // Storage refused; this page load still gets a view below.
  }
  return DEFAULT_ROLE;
}

export function applyRole(role: Role) {
  document.documentElement.setAttribute(ROLE_ATTR, role);
}

/** Persists and applies in one go, for the sign-in or the switcher that chose it. */
export function storeRole(role: Role) {
  try {
    window.sessionStorage.setItem(ROLE_KEY, role);
    window.localStorage.setItem(ROLE_KEY, role);
  } catch {
    // A browser refusing storage still gets the right view for this page load.
  }
  applyRole(role);
}

/**
 * Runs synchronously as the browser parses the document, before the first
 * paint. Same order of preference as readRole, in the smallest form that says
 * it: this is inlined into every document the app serves.
 *
 * It also writes back what it settled on, which is what makes a tab's view its
 * own from its very first document. A tab that had only ever borrowed the
 * fallback would otherwise keep borrowing it, and start following whatever the
 * last switch in some other tab left behind.
 */
export const ROLE_SCRIPT = `(function(){try{var k=${JSON.stringify(ROLE_KEY)},a=${JSON.stringify(
  KNOWN,
)},r=sessionStorage.getItem(k);if(a.indexOf(r)<0){r=localStorage.getItem(k);if(a.indexOf(r)<0)r=${JSON.stringify(
  DEFAULT_ROLE,
)};sessionStorage.setItem(k,r)}document.documentElement.setAttribute(${JSON.stringify(
  ROLE_ATTR,
)},r)}catch(e){}})()`;
