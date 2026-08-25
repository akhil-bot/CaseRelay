"use client";

import { useMemo } from "react";
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
          "Create a test case from a scenario. The user may refer to a scenario by child name (e.g. 'maya', 'rosa') or by scenario ID. If only a child name is given, first call list_scenarios to resolve it. Optionally accepts a deadline string (e.g. '45s' for demo speed, '17d' for realistic). Returns the case_id and due_at on success.",
        parameters: z.object({
          scenario: z.string().describe("Scenario ID or child name to create a case for."),
          due_in: z
            .string()
            .optional()
            .describe("Optional deadline duration, e.g. '45s' for 45 seconds or '17d' for 17 days."),
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
            pushCase({ caseId: result.case_id, scenario: match.id, childName: match.child_name });
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
        name: "run_fleet",
        description:
          'Submit a run for a case, starting the specialist agent fleet. The case_ref can be a case_id, a child name (e.g. "maya"), or a pronoun like "it" referring to the most recently created case. Check the session case registry context to resolve names to case IDs.',
        parameters: z.object({
          case_ref: z
            .string()
            .describe(
              'A case_id, child name, or pronoun ("it", "the case") referencing a case from this session.',
            ),
        }),
        handler: async ({ case_ref }: { case_ref: string }) => {
          try {
            const entry = findCase(case_ref);
            if (!entry) {
              return "No case found in this session. Create a case first.";
            }
            const ref = await submitRun(entry.caseId);
            for (const cb of subscribersRef.current) cb.onRunStarted(ref, entry.caseId);
            return JSON.stringify({
              run_id: ref.run_id,
              case_id: entry.caseId,
              child_name: entry.childName,
              state: ref.state,
            });
          } catch (err) {
            return `Error starting run: ${err instanceof Error ? err.message : String(err)}`;
          }
        },
      },
    ],
    // Stable: handler closures capture refs (findCase, pushCase are useCallback-stable;
    // scenarioCacheRef and subscribersRef are React refs that never change identity)
    [findCase, pushCase, scenarioCacheRef, subscribersRef],
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
