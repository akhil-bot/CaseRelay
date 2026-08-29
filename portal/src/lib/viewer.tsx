"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { COPY, copyFor } from "@/design/copy";
import { NAV_BY_ROLE, PERSONAS } from "@/design/personas";
import type { NavGroup, PersonaProfile, Role } from "@/design/personas";
import { applyRole, DEFAULT_ROLE, readRole, storeRole } from "@/lib/role";

/**
 * The switcher is in the header and most of what it changes is in the sidebar,
 * so the role is read through a store rather than passed down: every reader sees
 * the same value the moment it changes, in both copies of the sidebar.
 */
const roleListeners = new Set<() => void>();

function subscribeToRole(listener: () => void) {
  roleListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    roleListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function useRole(): [Role, (next: Role) => void] {
  const role = useSyncExternalStore(subscribeToRole, readRole, () => DEFAULT_ROLE);

  // Strict Mode remounts once in development and resets <html> to the
  // attributes React manages from JSX, discarding what the inline script wrote.
  // A no-op in production, where the script's value is never disturbed.
  useEffect(() => {
    applyRole(readRole());
  }, []);

  const setRole = useCallback((next: Role) => {
    storeRole(next);
    for (const listener of roleListeners) listener();
  }, []);

  return [role, setRole];
}

interface ViewerContextValue {
  /** Who is signed in. The one input to what the product offers. */
  role: Role;
  profile: PersonaProfile;
  copy: typeof COPY;
  /**
   * Every role's navigation, always. Which one is shown is settled in CSS off
   * the role on <html>, not by shortening this — see src/lib/role.ts.
   */
  navByRole: Record<Role, NavGroup[]>;
  setRole: (next: Role) => void;
}

const ViewerContext = createContext<ViewerContextValue | null>(null);

export function ViewerProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useRole();

  const value = useMemo<ViewerContextValue>(
    () => ({
      role,
      profile: PERSONAS[role],
      copy: copyFor(role),
      navByRole: NAV_BY_ROLE,
      setRole,
    }),
    [role, setRole],
  );

  return <ViewerContext.Provider value={value}>{children}</ViewerContext.Provider>;
}

export function useViewer() {
  const context = useContext(ViewerContext);
  if (!context) throw new Error("useViewer must be used inside ViewerProvider");
  return context;
}
