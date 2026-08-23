"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { Dot } from "@/components/ui/primitives";
import { cx, surface, type as type_ } from "@/design/tokens";
import { useDemo } from "@/lib/demo-store";
import { DEMO_STEPS } from "@/lib/mock/steps";
import { useViewer } from "@/lib/viewer";

/**
 * The scenario clock. One number drives every screen, but it only exists to move
 * the mock data along — so it sits in the sidebar footer next to the other demo
 * scaffolding rather than competing with real controls in the header.
 */
export function ScenarioControl() {
  const { step, setStep, next, prev, reset, autoplay, toggleAutoplay, meta, totalSteps } = useDemo();
  const { showsTechnical } = useViewer();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const stepButton =
    "flex size-6 shrink-0 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-surface hover:text-ink disabled:opacity-30";

  return (
    <div className="relative" ref={ref}>
      <p className={cx("px-1 pb-1.5", type_.label)}>
        {showsTechnical ? "Scenario clock" : "Demo timeline"}
      </p>

      <div className="flex items-center gap-0.5 rounded-full border border-line bg-surface-soft p-0.5">
        <button
          type="button"
          onClick={prev}
          disabled={step === 0}
          aria-label="Previous step"
          className={stepButton}
        >
          <Icon name="chevronLeft" size={14} />
        </button>

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-full px-1.5 py-1 transition-colors hover:bg-surface"
        >
          <Icon name="clock" size={13} className="shrink-0 text-brand" />
          <span className="min-w-0 flex-1 truncate text-left text-[12px] font-medium text-ink">
            {meta.dayLabel}
          </span>
          <span className="shrink-0 font-mono text-[10.5px] text-ink-muted">
            {step + 1}/{totalSteps}
          </span>
          <Icon name="chevronDown" size={13} className="shrink-0 text-ink-muted" />
        </button>

        <button
          type="button"
          onClick={toggleAutoplay}
          aria-label={autoplay ? "Pause scenario" : "Play scenario"}
          className={cx(
            "flex size-6 shrink-0 items-center justify-center rounded-full transition-colors",
            autoplay ? "bg-warn-soft text-warn" : "text-ink-soft hover:bg-surface hover:text-ink",
          )}
        >
          <Icon name={autoplay ? "pause" : "play"} size={13} />
        </button>

        <button
          type="button"
          onClick={next}
          disabled={step === totalSteps - 1}
          aria-label="Next step"
          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand text-white transition-colors hover:bg-brand-deep disabled:opacity-30"
        >
          <Icon name="chevronRight" size={14} />
        </button>
      </div>

      {open && (
        <div
          className={cx(surface.pop, "animate-rise absolute bottom-full left-0 z-30 mb-2 w-[300px] p-3")}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className={type_.label}>
                {showsTechnical ? "Scenario clock" : "Skip ahead in time"}
              </p>
              <p className="mt-1 text-[13px] font-medium text-ink">{meta.label}</p>
            </div>
            <button
              type="button"
              onClick={reset}
              className="flex shrink-0 items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[11.5px] text-ink-soft transition-colors hover:bg-surface-soft"
            >
              <Icon name="reset" size={13} />
              Restart
            </button>
          </div>

          <p className={cx("mt-1.5", type_.small)}>{meta.narration}</p>

          <ol className="mt-3 space-y-0.5">
            {DEMO_STEPS.map((item) => {
              const state = item.index === step ? "current" : item.index < step ? "past" : "future";
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setStep(item.index)}
                    className={cx(
                      "flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-left text-[12.5px] transition-colors",
                      state === "current"
                        ? "bg-brand-soft font-medium text-brand-deep"
                        : "text-ink-soft hover:bg-surface-soft",
                    )}
                  >
                    <Dot
                      variant={state === "current" ? "brand" : state === "past" ? "seal" : "neutral"}
                      pulse={state === "current"}
                    />
                    <span className="w-12 shrink-0 font-mono text-[10.5px] text-ink-muted">
                      {item.dayLabel}
                    </span>
                    <span className="truncate">{item.label}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}
