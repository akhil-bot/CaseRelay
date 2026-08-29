"use client";

import { useEffect, useMemo, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { CopilotChatConfigurationProvider, CopilotKit } from "@copilotkit/react-core/v2";
import type { ReactFrontendTool } from "@copilotkit/react-core/v2";
import type { ReactNode } from "react";
import { z } from "zod";
import { createCase, listScenarios, submitRun } from "@/lib/api";
import { COPILOT_RUNTIME_URL, isRuntimeAvailable } from "@/lib/copilot/config";
import { ConversationsProvider } from "@/lib/copilot/conversations";
import { ToolEventsProvider, useToolEvents } from "@/lib/copilot/tool-events";

export function CopilotProvider({ children }: { children: ReactNode }) {
  if (!isRuntimeAvailable) return <>{children}</>;

  return (
    <ToolEventsProvider>
      <CopilotProviderInner>{children}</CopilotProviderInner>
    </ToolEventsProvider>
  );
}

function CopilotProviderInner({ children }: { children: ReactNode }) {
  const { findCase, pushCase, scenarioCacheRef, subscribersRef } = useToolEvents();

  const findCaseRef = useRef(findCase);
  const pushCaseRef = useRef(pushCase);
  useEffect(() => { findCaseRef.current = findCase; }, [findCase]);
  useEffect(() => { pushCaseRef.current = pushCase; }, [pushCase]);

  // Stable refs for router and pathname so the frontendTools memo keeps a
  // zero-length dependency array (required to avoid the "must be a stable
  // array" warning from CopilotKit and the React Strict Mode double-mount issue).
  const router = useRouter();
  const pathname = usePathname();
  const routerRef = useRef(router);
  const pathnameRef = useRef(pathname);
  useEffect(() => { routerRef.current = router; }, [router]);
  useEffect(() => { pathnameRef.current = pathname; }, [pathname]);

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
            const ref = await submitRun(entry.caseId);
            for (const cb of subscribersRef.current) cb.onRunStarted(ref, entry.caseId);

            // Navigate to the case live view after a short pause so the AI's
            // acknowledgment line has a moment to start streaming before the
            // route changes. Only navigate if we're not already there.
            const targetPath = `/cases/${entry.caseId}`;
            if (pathnameRef.current !== targetPath) {
              setTimeout(() => {
                routerRef.current.push(targetPath);
              }, 1500);
            }

            return JSON.stringify({
              run_id: ref.run_id,
              case_id: entry.caseId,
              child_name: entry.childName,
              state: ref.state,
              live_view: targetPath,
            });
          } catch (err) {
            return `Couldn't start outreach: ${err instanceof Error ? err.message : String(err)}`;
          }
        },
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
