"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { CreatedCase, RunRef, Scenario } from "@/lib/api";

interface CaseEntry {
  caseId: string;
  scenario: string;
  childName: string;
}

export interface ToolEventCallbacks {
  onCaseCreated: (entry: CreatedCase, scenario: Scenario) => void;
  onRunStarted: (ref: RunRef, caseId: string) => void;
}

interface ToolEventsContextValue {
  caseEntries: CaseEntry[];
  subscribe: (cb: ToolEventCallbacks) => () => void;
  findCase: (hint: string) => CaseEntry | undefined;
  pushCase: (entry: CaseEntry) => void;
  scenarioCacheRef: React.RefObject<Scenario[] | null>;
  subscribersRef: React.RefObject<Set<ToolEventCallbacks>>;
}

const ToolEventsContext = createContext<ToolEventsContextValue | null>(null);

export function ToolEventsProvider({ children }: { children: ReactNode }) {
  const [caseEntries, setCaseEntries] = useState<CaseEntry[]>([]);
  const entriesRef = useRef(caseEntries);
  useEffect(() => {
    entriesRef.current = caseEntries;
  }, [caseEntries]);

  const scenarioCacheRef = useRef<Scenario[] | null>(null);
  const subscribersRef = useRef<Set<ToolEventCallbacks>>(new Set());

  const subscribe = useCallback((cb: ToolEventCallbacks) => {
    subscribersRef.current.add(cb);
    return () => {
      subscribersRef.current.delete(cb);
    };
  }, []);

  const pushCase = useCallback((entry: CaseEntry) => {
    setCaseEntries((prev) => [...prev, entry]);
  }, []);

  const findCase = useCallback((hint: string): CaseEntry | undefined => {
    const entries = entriesRef.current;
    if (entries.length === 0) return undefined;
    const lower = hint.toLowerCase().trim();
    if (!lower || lower === "it" || lower === "this" || lower === "that" || lower === "the case") {
      return entries[entries.length - 1];
    }
    return (
      entries.find((e) => e.caseId === hint) ||
      entries.find((e) => e.childName.toLowerCase() === lower) ||
      entries.find((e) => e.scenario.toLowerCase() === lower) ||
      entries.find((e) => e.childName.toLowerCase().includes(lower)) ||
      entries[entries.length - 1]
    );
  }, []);

  return (
    <ToolEventsContext.Provider
      value={{ caseEntries, subscribe, findCase, pushCase, scenarioCacheRef, subscribersRef }}
    >
      {children}
    </ToolEventsContext.Provider>
  );
}

export function useToolEvents() {
  const ctx = useContext(ToolEventsContext);
  if (!ctx) throw new Error("useToolEvents requires ToolEventsProvider");
  return ctx;
}
