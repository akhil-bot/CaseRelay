"use client";

import { useEffect, useMemo, useRef } from "react";
import { CopilotChatConfigurationProvider, CopilotKit } from "@copilotkit/react-core/v2";
import type { ReactFrontendTool } from "@copilotkit/react-core/v2";
import type { ReactNode } from "react";
import { z } from "zod";
import {
  CaseListWidget,
  CaseReviewWidget,
  ChildChoiceWidget,
  ReportWidget,
  type WidgetProps,
} from "@/components/copilot/chat-widgets";
import { ReportPrintRoot } from "@/components/copilot/ReportDocument";
import { listScenarios } from "@/lib/api";
import { COPILOT_RUNTIME_URL, isRuntimeAvailable } from "@/lib/copilot/config";
import { ConversationsProvider } from "@/lib/copilot/conversations";
import { useBeginOutreach } from "@/lib/copilot/outreach";
import { buildReport, reportToMarkdown } from "@/lib/copilot/report";
import { useMyCases } from "@/lib/copilot/my-cases";
import { ReportStoreProvider, useReportStore } from "@/lib/copilot/report-store";
import { UnknownChild, useTakeOnCase } from "@/lib/copilot/take-on";
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
  const { findCase, scenarioCacheRef } = useToolEvents();
  const { put: putReport } = useReportStore();
  const beginOutreach = useBeginOutreach();
  const takeOnCase = useTakeOnCase();
  const myCases = useMyCases();

  // Every one of these is read through a ref so the frontendTools memo can keep
  // a zero-length dependency array — CopilotKit requires a stable array, and
  // rebuilding it re-registers the tools on every navigation.
  const findCaseRef = useRef(findCase);
  const putReportRef = useRef(putReport);
  const beginOutreachRef = useRef(beginOutreach);
  const takeOnCaseRef = useRef(takeOnCase);
  const myCasesRef = useRef(myCases);
  useEffect(() => { findCaseRef.current = findCase; }, [findCase]);
  useEffect(() => { putReportRef.current = putReport; }, [putReport]);
  useEffect(() => { beginOutreachRef.current = beginOutreach; }, [beginOutreach]);
  useEffect(() => { takeOnCaseRef.current = takeOnCase; }, [takeOnCase]);
  useEffect(() => { myCasesRef.current = myCases; }, [myCases]);

  const frontendTools = useMemo(
    () => [
      {
        name: "list_scenarios",
        description:
          "List the children whose referrals are ready for an advocate to pick up. Call this when the volunteer asks who needs an advocate or what they can take on, or when they name a child you do not recognise. The names are drawn for the volunteer as a list they can pick from, so do not repeat them back — reply with one short line at most, such as asking which they would like to take on. If they answer with a name, pass it straight to create_case.",
        parameters: z.object({}),
        // Only the names cross into the model's context. The rest of each record —
        // the internal id, the complexity rating, the one-line title, the expected
        // outcome — is written for whoever is exercising the system, and any of it
        // repeated back to a volunteer would read as though they were the subject
        // of a test rather than an advocate for a child.
        handler: async () => {
          const scenarios = await listScenarios();
          scenarioCacheRef.current = scenarios;
          return JSON.stringify({
            children: scenarios.map((s) => s.child_name),
          });
        },
        // Nine names and "which would you like?" is a question with nine
        // answers. Drawn as choices, the answer is a click rather than the
        // volunteer typing back a name that is already on screen.
        render: ({ status, result }: WidgetProps) => (
          <ChildChoiceWidget status={status} result={result} />
        ),
      },
      {
        name: "list_cases",
        description:
          "List the cases assigned to the volunteer you are talking to. Call this whenever they ask about their own caseload — \"my cases\", \"what am I working on\", \"what's open\", \"anything overdue\", \"how many cases do I have\" — and before answering any question that depends on which cases are theirs. It returns only their cases, never the whole programme's, so treat what comes back as the complete answer. The cases are drawn for them as a list they can open, so do not repeat the names back; reply with one short line, such as what stands out or what needs them next.",
        parameters: z.object({}),
        handler: async () => {
          try {
            const mine = await myCasesRef.current();
            return JSON.stringify({
              cases: mine.map((item) => ({
                case_id: item.caseId,
                child_name: item.childName,
                status: item.status,
              })),
              total: mine.length,
            });
          } catch (err) {
            return `Couldn't read your caseload: ${err instanceof Error ? err.message : String(err)}`;
          }
        },
        // A caseload is a list of places to go, so each row is a way into the
        // case rather than a name the volunteer has to type back.
        render: ({ status, result }: WidgetProps) => (
          <CaseListWidget status={status} result={result} />
        ),
      },
      {
        name: "create_case",
        description:
          "Take on a child's case: open the case record from the child's referrals so it can be worked. Pass the child's first name as given (e.g. 'maya', 'rosa') — that is enough, and there is no need to look the child up first. Only call list_scenarios when the name is one you do not recognise. If the volunteer states a deadline, pass it through as due_in exactly as they said it. Returns the case_id and the date the work is due. The case opens in draft and needs a supervisor's approval before anything is sent.",
        parameters: z.object({
          scenario: z.string().describe("The child's first name, as the volunteer said it."),
          due_in: z
            .string()
            .optional()
            .describe(
              "Optional deadline, e.g. '10s' or '17d'. Pass through whatever the volunteer asked for and do not substitute a value of your own. '10s' is what a live demonstration wants: the follow-up sweep only acts on deadlines that have already passed, and anything longer leaves them still in the future when it lands, so the round stalls part-way. '17d' is a realistic court timeline.",
            ),
        }),
        handler: async ({ scenario, due_in }: { scenario: string; due_in?: string }) => {
          try {
            // The same act as picking the child off the list the assistant drew
            // — one scenario matched, one registry entry, one set of
            // subscribers told.
            const taken = await takeOnCaseRef.current(scenario, due_in);
            return JSON.stringify({
              case_id: taken.caseId,
              child_name: taken.childName,
              due_at: taken.dueAt,
            });
          } catch (err) {
            if (err instanceof UnknownChild) {
              return `${err.message} Waiting now: ${err.waiting.join(", ")}`;
            }
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
