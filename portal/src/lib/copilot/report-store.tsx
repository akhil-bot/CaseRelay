"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { CaseReport } from "@/lib/copilot/report";

/**
 * Where assembled reports live between the tool that builds one and the UI that
 * offers it.
 *
 * The tool cannot hand a report to the chat directly: a tool result is a string
 * bound for the model, and a download button needs the structured record, not
 * prose about it. So the tool puts the report here and returns only the markdown
 * the model should relay. The widget then looks the case up by id, which also
 * means reopening a conversation still finds the report rather than showing a
 * card with nothing behind it.
 */
interface ReportStoreValue {
  /** Assembled reports, keyed by case id. Latest build wins. */
  reports: Record<string, CaseReport>;
  put: (report: CaseReport) => void;
  /** The report currently being sent to paper, if any. */
  printing: CaseReport | null;
  print: (report: CaseReport) => void;
}

const ReportStoreContext = createContext<ReportStoreValue | null>(null);

export function ReportStoreProvider({ children }: { children: ReactNode }) {
  const [reports, setReports] = useState<Record<string, CaseReport>>({});
  const [printing, setPrinting] = useState<CaseReport | null>(null);

  const put = useCallback((report: CaseReport) => {
    setReports((prev) => ({ ...prev, [report.caseId]: report }));
  }, []);

  const print = useCallback((report: CaseReport) => {
    setPrinting(report);
  }, []);

  // Printing is a two-step move: the document has to be in the DOM before the
  // dialog opens, and setting state does not put it there. Two frames is what
  // guarantees a committed paint rather than a layout the browser has not yet
  // performed — one frame can still capture a half-built document on a cold
  // render. `afterprint` is what says the dialog is gone, whether the person
  // saved a PDF or cancelled; either way the document comes back out.
  const printedRef = useRef<CaseReport | null>(null);
  useEffect(() => {
    if (!printing || printedRef.current === printing) return;
    printedRef.current = printing;

    let live = true;
    const finish = () => {
      if (!live) return;
      printedRef.current = null;
      setPrinting(null);
    };

    window.addEventListener("afterprint", finish);
    const outer = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (live) window.print();
      });
    });

    return () => {
      live = false;
      cancelAnimationFrame(outer);
      window.removeEventListener("afterprint", finish);
    };
  }, [printing]);

  const value = useMemo<ReportStoreValue>(
    () => ({ reports, put, printing, print }),
    [reports, put, printing, print],
  );

  return <ReportStoreContext.Provider value={value}>{children}</ReportStoreContext.Provider>;
}

export function useReportStore(): ReportStoreValue {
  const ctx = useContext(ReportStoreContext);
  if (!ctx) throw new Error("useReportStore requires ReportStoreProvider");
  return ctx;
}

/**
 * Save text to the person's machine, entirely in the browser.
 *
 * Nothing is posted anywhere: the file is built from a string already in memory,
 * handed to the browser as an object URL, and the URL released once the click
 * has been dispatched. The release is deferred by a tick because revoking in the
 * same task cancels the download in Safari and older Firefox.
 */
export function downloadText(filename: string, contents: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: `${mime};charset=utf-8` }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
