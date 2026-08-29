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
import { deriveActivity, deriveCases, deriveCommitments, stepMeta } from "@/lib/derive";

/**
 * The scripted walkthrough: a synthetic case advanced by a step counter.
 *
 * Approvals are deliberately not part of it. What is waiting on a person comes
 * from the control plane, so that one screen tells the truth whatever step the
 * walkthrough happens to be on — see src/lib/live-approvals.tsx.
 */
interface DemoContextValue {
  step: number;
  setStep: (step: number) => void;
  next: () => void;
  prev: () => void;
  reset: () => void;
  autoplay: boolean;
  toggleAutoplay: () => void;
  meta: ReturnType<typeof stepMeta>;
  cases: ReturnType<typeof deriveCases>;
  commitments: ReturnType<typeof deriveCommitments>;
  activity: ReturnType<typeof deriveActivity>;
  totalSteps: number;
}

const DemoContext = createContext<DemoContextValue | null>(null);

export function DemoProvider({ children }: { children: ReactNode }) {
  const [step, setStepRaw] = useState(0);
  const [autoplay, setAutoplay] = useState(false);

  const setStep = useCallback((value: number) => {
    setStepRaw(Math.min(Math.max(value, 0), LAST_STEP));
  }, []);

  const next = useCallback(() => setStepRaw((s) => Math.min(s + 1, LAST_STEP)), []);
  const prev = useCallback(() => setStepRaw((s) => Math.max(s - 1, 0)), []);

  const reset = useCallback(() => {
    setStepRaw(0);
    setAutoplay(false);
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
    return {
      step,
      setStep,
      next,
      prev,
      reset,
      autoplay: playing,
      toggleAutoplay,
      meta: stepMeta(step),
      cases: deriveCases(step, commitments),
      commitments,
      activity: deriveActivity(step),
      totalSteps: DEMO_STEPS.length,
    };
  }, [step, setStep, next, prev, reset, playing, toggleAutoplay]);

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo() {
  const context = useContext(DemoContext);
  if (!context) throw new Error("useDemo must be used inside DemoProvider");
  return context;
}
