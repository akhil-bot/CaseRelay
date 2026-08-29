"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type Polled<T> =
  | { status: "loading" }
  | { status: "loaded"; data: T }
  | { status: "error"; message: string };

/**
 * Reads something from the control plane and keeps reading it.
 *
 * `load` must be stable — wrap it in useCallback — because a new identity
 * restarts the poll. What is already on screen stays there until the first read
 * of the new subject lands, rather than flashing back through a spinner.
 *
 * Two behaviours are deliberate. A backgrounded tab is watching nothing, so the
 * poll idles until it comes back and reads immediately when it does. And a blip
 * on data already on screen keeps that data rather than replacing the page with
 * an error: only a failure with nothing to fall back on surfaces as one.
 *
 * There is no fallback to fixtures. An empty result means the backend is
 * holding nothing, which is a fact worth showing.
 */
export function usePolled<T>(load: () => Promise<T>, intervalMs: number): [Polled<T>, () => void] {
  const [state, setState] = useState<Polled<T>>({ status: "loading" });
  const reloadRef = useRef<() => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let loadedOnce = false;
    // A poll, a manual refresh and a returning tab can all ask at once. Only
    // the most recent answer is allowed to land.
    let latest = 0;

    const schedule = () => {
      if (timer !== null) clearTimeout(timer);
      timer = cancelled ? null : setTimeout(tick, intervalMs);
    };

    const run = async () => {
      const attempt = ++latest;
      try {
        const data = await load();
        if (cancelled || attempt !== latest) return;
        loadedOnce = true;
        setState({ status: "loaded", data });
      } catch (err: unknown) {
        if (cancelled || attempt !== latest) return;
        if (!loadedOnce) {
          setState({
            status: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      } finally {
        if (!cancelled && attempt === latest) schedule();
      }
    };

    const tick = () => {
      if (document.hidden) {
        schedule();
        return;
      }
      void run();
    };

    const onVisibilityChange = () => {
      if (!document.hidden) void run();
    };

    reloadRef.current = () => void run();
    void run();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      reloadRef.current = () => {};
    };
  }, [load, intervalMs]);

  const refresh = useCallback(() => reloadRef.current(), []);
  return [state, refresh];
}
