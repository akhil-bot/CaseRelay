"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { DEMO_STEPS, LAST_STEP } from "@/lib/mock/steps";
import {
  deriveActivity,
  deriveCapabilityProofs,
  deriveCases,
  deriveCommitments,
  derivePendingApprovals,
  derivePolicyDecisions,
  stepMeta,
} from "@/lib/derive";

export type ApprovalDecision = "approved" | "declined";

interface DemoContextValue {
  step: number;
  setStep: (step: number) => void;
  next: () => void;
  prev: () => void;
  reset: () => void;
  autoplay: boolean;
  toggleAutoplay: () => void;
  decisions: Record<string, ApprovalDecision>;
  decide: (approvalId: string, decision: ApprovalDecision) => void;
  meta: ReturnType<typeof stepMeta>;
  cases: ReturnType<typeof deriveCases>;
  commitments: ReturnType<typeof deriveCommitments>;
  activity: ReturnType<typeof deriveActivity>;
  policyDecisions: ReturnType<typeof derivePolicyDecisions>;
  capabilities: ReturnType<typeof deriveCapabilityProofs>;
  pendingApprovals: ReturnType<typeof derivePendingApprovals>;
  totalSteps: number;
}

const DemoContext = createContext<DemoContextValue | null>(null);

export function DemoProvider({ children }: { children: ReactNode }) {
  const [step, setStepRaw] = useState(0);
  const [autoplay, setAutoplay] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, ApprovalDecision>>({});

  const setStep = useCallback((value: number) => {
    setStepRaw(Math.min(Math.max(value, 0), LAST_STEP));
  }, []);

  const next = useCallback(() => setStepRaw((s) => Math.min(s + 1, LAST_STEP)), []);
  const prev = useCallback(() => setStepRaw((s) => Math.max(s - 1, 0)), []);

  const reset = useCallback(() => {
    setStepRaw(0);
    setDecisions({});
    setAutoplay(false);
  }, []);

  const decide = useCallback((approvalId: string, decision: ApprovalDecision) => {
    setDecisions((current) => ({ ...current, [approvalId]: decision }));
    if (approvalId === "AP-8802" && decision === "approved") {
      setStepRaw((s) => Math.max(s, 7));
    }
  }, []);

  const toggleAutoplay = useCallback(() => setAutoplay((value) => !value), []);

  // Autoplay simply stops advancing at the last step; `playing` below reflects that
  // so the control can flip back to "Play" without writing state from an effect.
  const playing = autoplay && step < LAST_STEP;

  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => setStepRaw((s) => Math.min(s + 1, LAST_STEP)), 3800);
    return () => clearTimeout(timer);
  }, [playing, step]);

  const value = useMemo<DemoContextValue>(() => {
    const commitments = deriveCommitments(step);
    const pendingApprovals = derivePendingApprovals(step, decisions);
    return {
      step,
      setStep,
      next,
      prev,
      reset,
      autoplay: playing,
      toggleAutoplay,
      decisions,
      decide,
      meta: stepMeta(step),
      cases: deriveCases(step, commitments, pendingApprovals),
      commitments,
      activity: deriveActivity(step),
      policyDecisions: derivePolicyDecisions(step),
      capabilities: deriveCapabilityProofs(step),
      pendingApprovals,
      totalSteps: DEMO_STEPS.length,
    };
  }, [step, setStep, next, prev, reset, playing, toggleAutoplay, decisions, decide]);

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo() {
  const context = useContext(DemoContext);
  if (!context) throw new Error("useDemo must be used inside DemoProvider");
  return context;
}
