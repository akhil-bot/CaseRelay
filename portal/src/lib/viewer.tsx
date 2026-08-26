"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { COPY } from "@/design/copy";
import { NAV, PERSONAS } from "@/design/personas";
import type { NavItem, PersonaProfile } from "@/design/personas";

interface ViewerContextValue {
  profile: PersonaProfile;
  copy: typeof COPY;
  nav: NavItem[];
}

const ViewerContext = createContext<ViewerContextValue | null>(null);

export function ViewerProvider({ children }: { children: ReactNode }) {
  const value = useMemo<ViewerContextValue>(
    () => ({
      profile: PERSONAS.advocate,
      copy: COPY,
      nav: NAV,
    }),
    [],
  );

  return <ViewerContext.Provider value={value}>{children}</ViewerContext.Provider>;
}

export function useViewer() {
  const context = useContext(ViewerContext);
  if (!context) throw new Error("useViewer must be used inside ViewerProvider");
  return context;
}
