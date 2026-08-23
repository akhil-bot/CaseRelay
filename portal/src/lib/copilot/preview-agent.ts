import { AbstractAgent, EventType, type BaseEvent, type RunAgentInput } from "@ag-ui/client";
import { Observable } from "rxjs";

/**
 * A scripted AG-UI agent that runs in the browser.
 *
 * The portal is a UI prototype with no backend, but a chat panel that errors on
 * every message demonstrates nothing. This agent implements the same interface
 * the ADK agent will arrive on — `run()` returning a stream of AG-UI events — so
 * the chat surface, streaming, and context plumbing are all exercised for real.
 * Swapping in the ADK backend changes which agent the runtime resolves, nothing
 * else.
 *
 * It answers from the same synthetic fixtures the rest of the portal uses. It
 * does not call a model, and it never invents case facts.
 *
 * The replies carry no "this is a preview" marker of their own. The chat header
 * states which agent is answering for as long as the panel is open, which the
 * same note repeated on every turn only crowds out.
 */

/** Slow enough to read as generation, fast enough not to stall a demo. */
const CHUNK_MS = 18;
const THINKING_MS = 320;

interface Reply {
  match: RegExp;
  body: (context: PreviewContext) => string;
}

interface PreviewContext {
  persona: string;
  caseline: string;
  step: string;
}

const REPLIES: Reply[] = [
  {
    match: /overdue|stalled|behind|attention|urgent|risk/i,
    body: ({ caseline }) =>
      `Education is the gap on CR-1042. The commitment has gone 17 days without a verified owner, while legal accepted the referral and healthcare scheduled a visit.\n\n${caseline}\n\nI can only tell you that nobody has claimed the step. Whether that delay matters for Maya is a judgement for you and your supervisor.`,
  },
  {
    match: /approv|escalat|send|draft/i,
    body: () =>
      `There is one escalation waiting on a human. It names the recipient, the purpose, the fields it would disclose, the fields it withheld, and the policy rule it relies on.\n\nI cannot send it. Approval is a human decision, and the draft stays queued until a supervisor releases it.`,
  },
  {
    match: /quarantin|armor|injection|unsafe|attack|malicious/i,
    body: () =>
      `The school's response carried an instruction to retrieve medical notes. That is outside the education agent's data scope, so Model Armor quarantined the payload and the Safeguarding Verifier issued a policy-compliant retry.\n\nEvery withheld field was recorded on the audit trace rather than dropped silently.`,
  },
  {
    match: /who|owner|responsib|agent|fleet/i,
    body: () =>
      `Five partner agents are involved on this case, each with its own service identity and a scoped projection of the record: education, health, legal, shelter, and family services. The Continuity Orchestrator delegates to them and never sees raw partner records itself.\n\nEducation is the one currently without a verified owner.`,
  },
  {
    match: /timeline|history|what happened|recap|summar/i,
    body: ({ step }) =>
      `Where the scenario stands: ${step}\n\nThe short version is that a referral produced five commitments, four progressed, and the education handoff went quiet. A scheduled deadline woke the workflow rather than a person noticing.`,
  },
  {
    match: /decide|should i|recommend|best|placement|custody/i,
    body: () =>
      `That is outside what CaseRelay does. It tracks whether someone has taken responsibility for a step; it does not decide where a child lives, what care they receive, or how a case should be argued.\n\nI can show you the evidence behind a commitment, the deadlines, and who has and has not responded.`,
  },
];

const FALLBACK = ({ persona, caseline, step }: PreviewContext) =>
  `I can help you follow commitments, deadlines, and handoffs on this caseload.\n\n${persona}\n${caseline}\nScenario: ${step}\n\nTry asking what is overdue, who owns a step, what is waiting on approval, or why a partner response was refused.`;

function readContext(input: RunAgentInput): PreviewContext {
  const find = (needle: string) =>
    input.context?.find((entry) => entry.description.toLowerCase().includes(needle))?.value ?? "";

  return {
    persona: find("view") || "Signed in as an advocate.",
    caseline: find("caseload") || "",
    step: find("scenario") || "the walkthrough has not been advanced yet",
  };
}

function lastUserText(input: RunAgentInput): string {
  for (let index = input.messages.length - 1; index >= 0; index -= 1) {
    const message = input.messages[index];
    if (message.role === "user" && typeof message.content === "string") return message.content;
  }
  return "";
}

function compose(input: RunAgentInput): string {
  const context = readContext(input);
  const question = lastUserText(input);
  const reply = REPLIES.find((candidate) => candidate.match.test(question));
  return reply ? reply.body(context) : FALLBACK(context);
}

/** Split on whitespace boundaries so words are never torn mid-render. */
function chunk(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [text];
}

export class CaseRelayPreviewAgent extends AbstractAgent {
  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      const messageId = `preview-${Date.now()}`;
      const timers: ReturnType<typeof setTimeout>[] = [];
      const parts = chunk(compose(input));

      const emit = (event: Record<string, unknown>) => subscriber.next(event as unknown as BaseEvent);

      emit({ type: EventType.RUN_STARTED, threadId: input.threadId, runId: input.runId });

      timers.push(
        setTimeout(() => {
          emit({ type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" });

          parts.forEach((delta, index) => {
            timers.push(
              setTimeout(() => {
                emit({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta });
              }, index * CHUNK_MS),
            );
          });

          timers.push(
            setTimeout(
              () => {
                emit({ type: EventType.TEXT_MESSAGE_END, messageId });
                emit({ type: EventType.RUN_FINISHED, threadId: input.threadId, runId: input.runId });
                subscriber.complete();
              },
              parts.length * CHUNK_MS + CHUNK_MS,
            ),
          );
        }, THINKING_MS),
      );

      return () => timers.forEach(clearTimeout);
    });
  }
}
