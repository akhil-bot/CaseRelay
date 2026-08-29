"use client";

import { useEffect, useMemo, useRef } from "react";
import { CopilotChatConfigurationProvider, CopilotKit } from "@copilotkit/react-core/v2";
import type { ReactFrontendTool } from "@copilotkit/react-core/v2";
import type { ReactNode } from "react";
import { z } from "zod";
import {
  CaseReviewWidget,
  ReportWidget,
  type WidgetProps,
} from "@/components/copilot/chat-widgets";
import { ReportPrintRoot } from "@/components/copilot/ReportDocument";
import { createCase, listScenarios } from "@/lib/api";
import { COPILOT_RUNTIME_URL, isRuntimeAvailable } from "@/lib/copilot/config";
import { ConversationsProvider } from "@/lib/copilot/conversations";
import { useBeginOutreach } from "@/lib/copilot/outreach";
import { buildReport, reportToMarkdown } from "@/lib/copilot/report";
import { ReportStoreProvider, useReportStore } from "@/lib/copilot/report-store";
import { ToolEventsProvider, useToolEvents } from "@/lib/copilot/tool-events";

/** A bare case id, as opposed to a child's name or a pronoun. */
const CASE_ID = /^[a-z]{2,4}-\d+$/i;

export function CopilotProvider({ children }: { children: ReactNode }) {
  // The registry and the report store are plain client state, so both are
  // mounted whether or not the runtime is configured. Pages read the registry to
  // hear about cases the chat created; with no runtime nothing ever publishes,
  // which is the correct empty answer rather than grounds for the hook to throw.
  //
  // `ReportPrintRoot` sits here, beside `children`, because a provider renders no
  // element of its own: that makes the printable document a direct child of
  // `<body>`, which is what the `@media print` rule in globals.css selects on.
  return (
    <ToolEventsProvider>
      <ReportStoreProvider>
        {isRuntimeAvailable ? <CopilotProviderInner>{children}</CopilotProviderInner> : children}
        <ReportPrintRoot />
      </ReportStoreProvider>
    </ToolEventsProvider>
  );
}

function CopilotProviderInner({ children }: { children: ReactNode }) {
  const { findCase, pushCase, scenarioCacheRef, subscribersRef } = useToolEvents();
  const { put: putReport } = useReportStore();
  const beginOutreach = useBeginOutreach();

  // Every one of these is read through a ref so the frontendTools memo can keep
  // a zero-length dependency array — CopilotKit requires a stable array, and
  // rebuilding it re-registers the tools on every navigation.
  const findCaseRef = useRef(findCase);
  const pushCaseRef = useRef(pushCase);
  const putReportRef = useRef(putReport);
  const beginOutreachRef = useRef(beginOutreach);
  useEffect(() => { findCaseRef.current = findCase; }, [findCase]);
  useEffect(() => { pushCaseRef.current = pushCase; }, [pushCase]);
  useEffect(() => { putReportRef.current = putReport; }, [putReport]);
  useEffect(() => { beginOutreachRef.current = beginOutreach; }, [beginOutreach]);

  const frontendTools = useMemo(
    () => [
      {
        name: "list_scenarios",
        description:
          "List available test scenarios. Each scenario has an id, child_name, complexity (simple or complex), title, and expected_outcome. Call this when the user asks what scenarios are available or when you need to resolve a child name to a scenario ID.",
        parameters: z.object({}),
        handler: async () => {
          const scenarios = await listScenarios();
          scenarioCacheRef.current = scenarios;
          return JSON.stringify({
            scenarios: scenarios.map((s) => ({
              id: s.id,
              child_name: s.child_name,
              complexity: s.complexity,
              title: s.title,
              expected_outcome: s.expected_outcome,
            })),
          });
        },
      },
      {
        name: "create_case",
        description:
          "Create a test case from a scenario. The user may refer to a scenario by child name (e.g. 'maya', 'rosa') or by scenario ID. If only a child name is given, first call list_scenarios to resolve it. Optionally accepts a deadline string — use '10s' for demos (checkpoints must already be past-due when the wake phase runs; values above ~10s stall the run and cause partial_failure), '17d' for realistic timelines. Returns the case_id and due_at on success.",
        parameters: z.object({
          scenario: z.string().describe("Scenario ID or child name to create a case for."),
          due_in: z
            .string()
            .optional()
            .describe("Optional deadline duration. Use '10s' for demos — values above ~10s stall checkpoints and the run fails. Use '17d' for realistic timelines."),
        }),
        handler: async ({ scenario, due_in }: { scenario: string; due_in?: string }) => {
          try {
            if (!scenarioCacheRef.current) {
              scenarioCacheRef.current = await listScenarios();
            }
            const match =
              scenarioCacheRef.current.find((s) => s.id === scenario) ||
              scenarioCacheRef.current.find(
                (s) => s.child_name.toLowerCase() === scenario.toLowerCase(),
              );
            if (!match) {
              const available = scenarioCacheRef.current.map((s) => s.child_name).join(", ");
              return `No scenario found matching "${scenario}". Available: ${available}`;
            }
            const result = await createCase(match.id, due_in);
            pushCaseRef.current({ caseId: result.case_id, scenario: match.id, childName: match.child_name });
            for (const cb of subscribersRef.current) cb.onCaseCreated(result, match);
            return JSON.stringify({
              case_id: result.case_id,
              scenario: result.scenario,
              child_name: match.child_name,
              due_at: result.due_at,
            });
          } catch (err) {
            return `Error creating case: ${err instanceof Error ? err.message : String(err)}`;
          }
        },
        // The case is set up but nothing has been sent, and what happens next is
        // a person's call — so the reply is a card with the decision on it
        // rather than a paragraph asking them to type "start outreach" back.
        render: ({ status, result }: WidgetProps) => (
          <CaseReviewWidget status={status} result={result} />
        ),
      },
      {
        name: "start_outreach",
        description:
          'Start a round of outreach for a case, contacting all service providers on the child\'s behalf. The case_ref can be a case_id, a child name (e.g. "maya"), or a pronoun like "it" referring to the most recently created case. Check the session case registry context to resolve names to case IDs. Use this when the volunteer says things like "start outreach", "reach out to the providers", "get started on this case", "chase them up", "kick it off", or "run it". When outreach starts successfully, respond with exactly one short line telling the user you\'re opening the live view for them — e.g. "Opening the live view for you now." — before any other details.',
        parameters: z.object({
          case_ref: z
            .string()
            .describe(
              'A case_id, child name, or pronoun ("it", "the case") referencing a case from this session.',
            ),
        }),
        handler: async ({ case_ref }: { case_ref: string }) => {
          try {
            const entry = findCaseRef.current(case_ref);
            if (!entry) {
              return "No case found in this session. Create a case first.";
            }
            // The same act as pressing the button on the case card — one run,
            // one set of subscribers notified, one navigation.
            const started = await beginOutreachRef.current(entry.caseId);

            return JSON.stringify({
              run_id: started.runId,
              case_id: started.caseId,
              child_name: entry.childName,
              live_view: started.livePath,
            });
          } catch (err) {
            return `Couldn't start outreach: ${err instanceof Error ? err.message : String(err)}`;
          }
        },
      },
      {
        name: "case_report",
        description:
          'Assemble a CASA court report for a case from its stored record and its audit log. The case_ref can be a case_id, a child name, or a pronoun like "it" referring to the most recently created case. Use this when the volunteer asks for a report, a summary, a write-up, or "what happened on this case".\n\nThe returned `report_markdown` is the finished report. Reply with that markdown exactly as given and nothing else — do not summarise it, reorder it, retitle it, or add observations of your own. It is assembled from recorded case state, and anything you add would not be.\n\nThe report deliberately leaves several sections blank — impressions of the child, the child\'s wishes, recommendations, and others marked "To be completed by the CASA volunteer". These are the volunteer\'s judgement to write and CaseRelay holds no record of them. Never fill them in, never suggest wording for them, and never apologise for them being empty. Leave them exactly as they are.\n\nA card offering the file as a download is shown automatically beneath your reply, so do not offer to send or generate a file yourself.',
        parameters: z.object({
          case_ref: z
            .string()
            .describe(
              'A case_id, child name, or pronoun ("it", "the case") naming the case to report on.',
            ),
        }),
        handler: async ({ case_ref }: { case_ref: string }) => {
          const hint = case_ref.trim();
          try {
            // A bare case id is taken at its word. Anything else goes through the
            // registry, which resolves names but falls back to the most recent
            // case for an unfamiliar hint — helpful for "it", wrong for a case id
            // belonging to a case this session did not create.
            const caseId = CASE_ID.test(hint)
              ? hint
              : (findCaseRef.current(hint)?.caseId ?? hint);

            const report = await buildReport(caseId);
            // Held for the card, which needs the record rather than the prose:
            // the download has to be the case's own state even if the model
            // paraphrases the markdown on its way through.
            putReportRef.current(report);

            return JSON.stringify({
              case_id: report.caseId,
              child_name: report.childName,
              report_markdown: reportToMarkdown(report),
            });
          } catch (err) {
            return `Couldn't build a report for ${hint || "that case"}: ${
              err instanceof Error ? err.message : String(err)
            }`;
          }
        },
        render: ({ status, result }: WidgetProps) => (
          <ReportWidget status={status} result={result} />
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <CopilotChatConfigurationProvider isModalDefaultOpen={false}>
      <CopilotKit
        runtimeUrl={COPILOT_RUNTIME_URL}
        useSingleEndpoint
        frontendTools={frontendTools as unknown as ReactFrontendTool[]}
        enableInspector={false}
        showDevConsole={false}
      >
        <ConversationsProvider>{children}</ConversationsProvider>
      </CopilotKit>
    </CopilotChatConfigurationProvider>
  );
}
