"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAgentContext, useFrontendTool } from "@copilotkit/react-core/v2";
import { z } from "zod";
import {
  createCase,
  listScenarios,
  submitRun,
  type CreatedCase,
  type RunRef,
  type Scenario,
} from "@/lib/api";

interface CaseEntry {
  caseId: string;
  scenario: string;
  childName: string;
}

/**
 * Registers CopilotKit frontend tools for the admin page: list_scenarios,
 * create_case, and run_fleet. Maintains a session-scoped case registry so
 * the agent can resolve conversational references like "run maya's case".
 */
export function useAdminCopilotTools(callbacks: {
  onCaseCreated: (entry: CreatedCase, scenario: Scenario) => void;
  onRunStarted: (ref: RunRef, caseId: string) => void;
}) {
  const [caseEntries, setCaseEntries] = useState<CaseEntry[]>([]);
  const scenarioCache = useRef<Scenario[] | null>(null);
  const entriesRef = useRef(caseEntries);
  useEffect(() => {
    entriesRef.current = caseEntries;
  }, [caseEntries]);

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

  const contextValue =
    caseEntries.length === 0
      ? "No cases created this session."
      : caseEntries
          .map((e) => `${e.childName} → ${e.caseId} (scenario: ${e.scenario})`)
          .join("; ");

  useAgentContext({
    description: "Session case registry — maps child names to case IDs for conversational reference",
    value: contextValue,
  });

  useFrontendTool(
    {
      name: "list_scenarios",
      description:
        "List available test scenarios. Each scenario has an id, child_name, complexity (simple or complex), title, and expected_outcome. Call this when the user asks what scenarios are available or when you need to resolve a child name to a scenario ID.",
      parameters: z.object({}),
      handler: async () => {
        try {
          const scenarios = await listScenarios();
          scenarioCache.current = scenarios;
          return JSON.stringify({
            scenarios: scenarios.map((s) => ({
              id: s.id,
              child_name: s.child_name,
              complexity: s.complexity,
              title: s.title,
              expected_outcome: s.expected_outcome,
            })),
          });
        } catch (err) {
          return `Error listing scenarios: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    [],
  );

  useFrontendTool(
    {
      name: "create_case",
      description:
        "Create a test case from a scenario. The user may refer to a scenario by child name (e.g. 'maya', 'rosa') or by scenario ID. If only a child name is given, first call list_scenarios to resolve it. Optionally accepts a deadline string (e.g. '45s' for demo speed, '17d' for realistic). Returns the case_id and due_at on success.",
      parameters: z.object({
        scenario: z
          .string()
          .describe("Scenario ID or child name to create a case for."),
        due_in: z
          .string()
          .optional()
          .describe(
            "Optional deadline duration, e.g. '45s' for 45 seconds or '17d' for 17 days.",
          ),
      }),
      handler: async ({ scenario, due_in }) => {
        try {
          if (!scenarioCache.current) {
            scenarioCache.current = await listScenarios();
          }

          const match =
            scenarioCache.current.find((s) => s.id === scenario) ||
            scenarioCache.current.find(
              (s) => s.child_name.toLowerCase() === scenario.toLowerCase(),
            );

          if (!match) {
            const available = scenarioCache.current.map((s) => s.child_name).join(", ");
            return `No scenario found matching "${scenario}". Available: ${available}`;
          }

          const result = await createCase(match.id, due_in);

          const entry: CaseEntry = {
            caseId: result.case_id,
            scenario: match.id,
            childName: match.child_name,
          };
          setCaseEntries((prev) => [...prev, entry]);

          callbacks.onCaseCreated(result, match);

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
    [callbacks.onCaseCreated],
  );

  useFrontendTool(
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
      handler: async ({ case_ref }) => {
        try {
          const entry = findCase(case_ref);
          if (!entry) {
            return "No case found in this session. Create a case first.";
          }

          const ref = await submitRun(entry.caseId);

          callbacks.onRunStarted(ref, entry.caseId);

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
    [findCase, callbacks.onRunStarted],
  );
}
