"use client";

import {
  CopilotChatAssistantMessage,
  type CopilotChatAssistantMessageProps,
  type CopilotChatToolCallsViewProps,
  type CopilotModalHeaderProps,
} from "@copilotkit/react-core/v2";
import type { ButtonHTMLAttributes, SVGProps } from "react";
import {
  ConversationHistoryButton,
  ConversationHistoryPanel,
  NewConversationButton,
} from "@/components/copilot/conversation-history";
import { Icon } from "@/components/icons";
import { LogoMark } from "@/components/Logo";
import { chrome, cx, tone, type as type_ } from "@/design/tokens";
import { formatEventTime } from "@/lib/case-events";
import { isAdkConnected } from "@/lib/copilot/config";

/**
 * Slot replacements that make CopilotKit render as a CaseRelay surface.
 *
 * CopilotKit's v2 components take a slot per sub-element, where a slot accepts
 * a className, a props object, or a whole replacement component. That is the
 * seam used here: the transport, streaming and message state stay CopilotKit's,
 * while everything visible is ours.
 */

/**
 * Stands in for a slot we want gone. Returns a fragment rather than `null`
 * because some slots are typed to return an element; both render nothing.
 */
export const Hidden = () => <></>;

type ChatMessage = NonNullable<CopilotChatToolCallsViewProps["messages"]>[number];
type AssistantTurn = CopilotChatToolCallsViewProps["message"];
type ToolStep = NonNullable<AssistantTurn["toolCalls"]>[number];

/**
 * What each step the assistant can take is called in front of a volunteer.
 *
 * The panel never shows a tool name: an advocate needs to know the case was set
 * up, not which function did it. `doing` runs while a step is still in flight
 * and `done` once its result is back, so a line that is still moving reads in
 * the present tense. Anything unrecognised falls back to a phrase that says
 * nothing about the mechanism rather than leaking an identifier.
 */
const STEP_COPY: Record<string, { doing: string; done: string }> = {
  list_scenarios: {
    doing: "Checking which cases you can start",
    done: "Checked which cases you can start",
  },
  create_case: { doing: "Setting up the case", done: "Set up the case" },
  start_outreach: {
    doing: "Starting outreach to the providers",
    done: "Started outreach to the providers",
  },
};

const STEP_FALLBACK = { doing: "Working on it", done: "Finished that step" };

/**
 * When each message first appeared, kept outside React because the transport
 * carries no timestamp of its own and a re-render must not restamp a message.
 *
 * Written on first render rather than from an effect: a message keeps one id
 * across every streaming update, so the value settles on the moment the reply
 * began arriving and never moves again.
 */
const firstSeen = new Map<string, string>();

function firstSeenAt(id: string): string {
  let at = firstSeen.get(id);
  if (at === undefined) {
    at = new Date().toISOString();
    firstSeen.set(id, at);
  }
  return at;
}

function isAssistant(message: ChatMessage | undefined): message is AssistantTurn {
  return message?.role === "assistant";
}

function hasText(message: AssistantTurn): boolean {
  return !!message.content && message.content.trim().length > 0;
}

/** Whether a message puts anything on screen. */
function speaks(message: ChatMessage | undefined): boolean {
  if (!isAssistant(message)) return false;
  return hasText(message) || !!message.toolCalls?.length;
}

/**
 * Roles the thread never draws. They sit between the messages of one reply —
 * a step's result arrives as its own message — so they are filtered out before
 * anything reasons about which message came before which.
 */
const UNDRAWN_ROLES = new Set(["tool", "system", "developer"]);

/**
 * Whether this message opens the reply: the first message the assistant draws
 * since the volunteer last spoke. One reply arrives as several messages — one
 * per step it takes, then the prose — and only the opener is stamped, so an
 * exchange carries one time rather than one per fragment of the same answer.
 */
function opensReply(turns: ChatMessage[], message: AssistantTurn): boolean {
  const index = turns.findIndex((m) => m.id === message.id);
  for (let i = index - 1; i >= 0 && isAssistant(turns[i]); i -= 1) {
    if (speaks(turns[i])) return false;
  }
  return true;
}

/**
 * The steps a message took, said as one quiet line at the thread's left edge.
 *
 * Steps that fire together collapse into this single line, and repeats of the
 * same step fold into one phrase, so a burst never stacks up as a column of
 * marks. A step only reads as finished once every call of it has a result back,
 * so a line still waiting on one stays in the present tense and pulses.
 */
function StepLine({ steps, messages }: { steps: ToolStep[]; messages: ChatMessage[] }) {
  const settledByName = new Map<string, boolean>();
  for (const step of steps) {
    const done = messages.some((m) => m.role === "tool" && m.toolCallId === step.id);
    const name = step.function.name;
    settledByName.set(name, (settledByName.get(name) ?? true) && done);
  }

  const phrases = Array.from(settledByName, ([name, done]) => {
    const copy = STEP_COPY[name] ?? STEP_FALLBACK;
    return done ? copy.done : copy.doing;
  });
  const running = Array.from(settledByName.values()).some((done) => !done);

  return (
    <p
      className={cx(
        type_.meta,
        "mb-1.5 leading-relaxed",
        running && "motion-safe:animate-pulse",
      )}
    >
      {Array.from(new Set(phrases)).join(" · ")}
    </p>
  );
}

/**
 * When a reply arrived, read off the same formatter the activity feed uses so
 * the two panels can never drift apart, and set on the right like the feed's
 * own column — which keeps the left edge for what the volunteer is reading.
 *
 * `tabular-nums` holds the digits still while a reply streams beneath it.
 */
function ReplyTime({ id }: { id: string }) {
  const label = formatEventTime(firstSeenAt(id));
  if (!label) return null;

  return <p className={cx(type_.monoSmall, "mb-1.5 text-right tabular-nums")}>{label}</p>;
}

/**
 * Assistant turn: time, then the steps behind the reply, then the reply, all on
 * the thread's single left edge.
 *
 * There is no avatar. The panel header names the assistant permanently 64px
 * above, so a mark on every turn only repeated it — and because a message
 * carrying steps alone has no prose to sit beside, that gutter was what stacked
 * bare glyphs down the side of the thread and pushed the text it was meant to
 * label onto a second edge.
 *
 * `toolCallsView` is taken over rather than filled: the SDK renders one element
 * per call and puts them under the prose, where the mechanism would read as part
 * of the answer. One line, above the answer, is what this panel wants.
 *
 * The toolbar is cut back to copy alone. Thumbs-up/down posts feedback nowhere,
 * read-aloud needs a voice backend, regenerate re-bills a run, and the inspector
 * exposes raw CopilotKit internals — none of them belong in front of an advocate.
 */
function AssistantMessageView({
  className,
  message,
  messages,
  ...props
}: CopilotChatAssistantMessageProps) {
  const thread = messages ?? [];
  const steps = message.toolCalls ?? [];
  if (!hasText(message) && steps.length === 0) return null;

  const leads = opensReply(
    thread.filter((m) => !UNDRAWN_ROLES.has(m.role)),
    message,
  );

  // A reply arrives in pieces. Steps stay tight against each other so they read
  // as one list, and the prose that answers gets the gap the markdown puts
  // between paragraphs, so the whole thing still reads as a single reply.
  const gap = leads ? undefined : hasText(message) ? "mt-4" : "mt-1.5";

  return (
    <div className={cx(gap)}>
      {leads && <ReplyTime id={message.id} />}
      {steps.length > 0 && <StepLine steps={steps} messages={thread} />}

      <CopilotChatAssistantMessage
        {...props}
        message={message}
        messages={messages}
        thumbsUpButton={Hidden}
        thumbsDownButton={Hidden}
        readAloudButton={Hidden}
        regenerateButton={Hidden}
        inspectorButton={Hidden}
        toolCallsView={Hidden}
        className={cx("min-w-0", className)}
      />
    </div>
  );
}

/**
 * The slot is typed as `typeof CopilotChatAssistantMessage`, which carries the
 * component's static namespace (MarkdownRenderer, Toolbar, CopyButton and six
 * more). A replacement is only ever called as a component, so those statics are
 * unreachable — the assertion says that once instead of re-exporting all nine.
 */
export const AssistantMessage =
  AssistantMessageView as unknown as typeof CopilotChatAssistantMessage;

/**
 * The header mark, and on hover the bound the assistant answers under.
 *
 * That line used to hang off an avatar beside every turn. It belongs to the
 * assistant as a whole rather than to any one reply, so it moved to the mark
 * the header already spends room on, where it is stated once and still costs
 * nothing until asked for. `aria-hidden`, because it is a restatement for the
 * eye beside a header that already names what this panel is.
 */
function AssistantIdentity() {
  return (
    <span className="group relative shrink-0" aria-hidden="true">
      <LogoMark size={22} />

      <span className="pointer-events-none absolute top-full left-0 z-30 mt-2 w-max max-w-[210px] rounded-control border border-line bg-surface px-2.5 py-1.5 opacity-0 shadow-pop transition duration-150 group-hover:opacity-100 motion-safe:translate-y-1 motion-safe:group-hover:translate-y-0">
        <span className="block text-[11.5px] font-medium text-ink">CaseRelay assistant</span>
        <span className="mt-0.5 block text-[11px] leading-snug text-ink-muted">
          Reads your view. Decides nothing.
        </span>
      </span>
    </span>
  );
}

/**
 * Presence indicator in the chat header. The dot is the product's one green,
 * which the palette rule reserves for exactly this.
 */
function StatusPill() {
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-[3px] text-[10.5px] leading-none font-medium",
        tone.neutral.badge,
      )}
    >
      <span className="size-1.5 rounded-full bg-live" aria-hidden="true" />
      {isAdkConnected ? "Live" : "Active"}
    </span>
  );
}

/**
 * The close control, as the same mark and hover target the rest of the shell
 * uses rather than the SDK's lucide glyph. `onClick` arrives bound through
 * props, so the panel still closes through the chat configuration.
 */
export function ChatCloseButton({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label="Close assistant"
      {...props}
      className={cx(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink",
        className,
      )}
    >
      <Icon name="close" size={17} />
    </button>
  );
}

/** The payload `CopilotModalHeader` hands to a `children` render function. */
type ChatHeaderProps = Parameters<NonNullable<CopilotModalHeaderProps["children"]>>[0];

/**
 * Header lockup: the mark, who is answering, and whether it is up.
 *
 * This replaces the header's layout rather than filling its title slot, because
 * the default arranges launcher, title and close as three equal thirds, which
 * leaves a name and a status pill nowhere to sit in a 492px panel. Owning the
 * element also lets the row match the app header's 64px, so the two align where
 * the panel meets the page.
 *
 * `drawerLauncher` is dropped from the payload: it only binds for a mounted
 * `CopilotThreadsDrawer`, which is licence-gated and would put an upgrade
 * prompt in this header, so the conversation controls beside it are our own.
 */
function ChatHeaderView({ closeButton }: ChatHeaderProps) {
  return (
    <>
      <header className={cx(chrome.row, "gap-2.5 bg-surface px-4")}>
        <AssistantIdentity />

        {/* The pill is the tallest thing on this line, so the line box is what
            holds the row to the same height as the header it sits beside. */}
        <div className={cx(chrome.title, "flex min-w-0 flex-1 items-center gap-2")}>
          <span className="truncate text-[13.5px] font-semibold text-ink">CaseRelay assistant</span>
          <StatusPill />
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <NewConversationButton />
          <ConversationHistoryButton />
          {closeButton}
        </div>
      </header>

      {/* Out of flow, so it overlays the message list without the header
          having to give up any of its 64px. */}
      <ConversationHistoryPanel />
    </>
  );
}

/**
 * `CopilotModalHeader` calls its `children` as a plain function rather than
 * mounting it, so anything with hooks has to be rendered as an element to get a
 * scope of its own instead of borrowing the SDK component's.
 */
export const ChatHeader = (payload: ChatHeaderProps) => <ChatHeaderView {...payload} />;

/** Launcher glyph, closed state. Light variant: the button runs brand blue. */
export function ToggleOpenIcon({ className }: SVGProps<SVGSVGElement>) {
  return <LogoMark size={26} variant="light" className={className} />;
}

/** Launcher glyph, open state — the product's own close mark. */
export function ToggleCloseIcon({ className }: SVGProps<SVGSVGElement>) {
  return <Icon name="close" size={22} className={className} />;
}
