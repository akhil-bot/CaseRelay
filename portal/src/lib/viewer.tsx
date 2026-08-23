"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { COPY } from "@/design/copy";
import { NAV, PERSONAS, type Persona, type PersonaProfile } from "@/design/personas";

interface ViewerContextValue {
  persona: Persona;
  profile: PersonaProfile;
  copy: (typeof COPY)[Persona];
  nav: (typeof NAV)[Persona];
  /** True for the platform administrator: identities, spans, rule IDs, checkpoints. */
  showsTechnical: boolean;
  setPersona: (persona: Persona) => void;
}

const ViewerContext = createContext<ViewerContextValue | null>(null);

export function ViewerProvider({ children }: { children: ReactNode }) {
  const [persona, setPersonaRaw] = useState<Persona>("advocate");

  const setPersona = useCallback((next: Persona) => setPersonaRaw(next), []);

  const value = useMemo<ViewerContextValue>(
    () => ({
      persona,
      profile: PERSONAS[persona],
      copy: COPY[persona],
      nav: NAV[persona],
      showsTechnical: persona === "platform",
      setPersona,
    }),
    [persona, setPersona],
  );

  return <ViewerContext.Provider value={value}>{children}</ViewerContext.Provider>;
}

export function useViewer() {
  const context = useContext(ViewerContext);
  if (!context) throw new Error("useViewer must be used inside ViewerProvider");
  return context;
}
