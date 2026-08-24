"use client";

import {
  CopilotChatAssistantMessage,
  type CopilotChatAssistantMessageProps,
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
import { chrome, cx, tone } from "@/design/tokens";
import { isAdkConnected, isRuntimeAvailable } from "@/lib/copilot/config";
import { useViewer } from "@/lib/viewer";

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

/**
 * The assistant's avatar is the CaseRelay mark, not a face.
 *
 * A doodle of a person would imply someone is answering, and this product's
 * whole claim is the opposite: the agents carry paperwork forward and a human
 * still decides. The shield keeps the assistant legibly a piece of software.
 *
 * Hovering it names what just answered and restates the bound it answers under.
 * That line used to run in the header, where it cost a permanent row; here it is
 * attached to the thing it describes and costs nothing until asked for.
 *
 * The whole lockup stays `aria-hidden`. It is decoration beside a message that
 * is already labelled, and a focusable tooltip would put a tab stop in front of
 * every assistant turn to repeat what the panel header states once.
 */
function AssistantAvatar() {
  const { showsTechnical } = useViewer();

  return (
    <span className="group relative mt-0.5 shrink-0" aria-hidden="true">
      <span className="flex size-7 items-center justify-center rounded-full bg-brand-soft ring-0 ring-brand/0 transition duration-200 group-hover:ring-2 group-hover:ring-brand/25 motion-safe:group-hover:-translate-y-0.5 motion-safe:group-hover:scale-110">
        <LogoMark size={16} />
      </span>

      <span className="pointer-events-none absolute top-full left-0 z-30 mt-2 w-max max-w-[210px] rounded-control border border-line bg-surface px-2.5 py-1.5 opacity-0 shadow-pop transition duration-150 group-hover:opacity-100 motion-safe:translate-y-1 motion-safe:group-hover:translate-y-0">
        <span className="block text-[11.5px] font-medium text-ink">
          {showsTechnical ? "Fleet assistant" : "CaseRelay assistant"}
        </span>
        <span className="mt-0.5 block text-[11px] leading-snug text-ink-muted">
          {showsTechnical
            ? "Reads the fleet. Changes nothing."
            : "Reads your view. Decides nothing."}
        </span>
      </span>
    </span>
  );
}

/**
 * Assistant turn: avatar in the gutter, message beside it, and a toolbar cut
 * back to copy alone. Thumbs-up/down posts feedback nowhere, read-aloud needs a
 * voice backend, regenerate re-bills a run, and the inspector exposes raw
 * CopilotKit internals — none of them belong in front of an advocate.
 */
function AssistantMessageView({ className, ...props }: CopilotChatAssistantMessageProps) {
  return (
    <div className="flex gap-2.5">
      <AssistantAvatar />
      <CopilotChatAssistantMessage
        {...props}
        thumbsUpButton={Hidden}
        thumbsDownButton={Hidden}
        readAloudButton={Hidden}
        regenerateButton={Hidden}
        inspectorButton={Hidden}
        className={cx("min-w-0 flex-1", className)}
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
 * Presence, and which agent is behind it: scripted fixtures while the portal
 * runs on its own, the deployed fleet once `NEXT_PUBLIC_ADK_AGENT_URL` is set.
 * Held in the header as standing chrome — the alternative is a line the
 * assistant repeats in every single reply.
 *
 * The dot is the product's one green, which the palette rule reserves for
 * exactly this.
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
      {isAdkConnected ? "Live fleet" : isRuntimeAvailable ? "Built-in agent" : "Online"}
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
  const { showsTechnical } = useViewer();

  return (
    <>
      <header className={cx(chrome.row, "gap-2.5 bg-surface px-4")}>
        <LogoMark size={22} />

        {/* The pill is the tallest thing on this line, so the line box is what
            holds the row to the same height as the header it sits beside. */}
        <div className={cx(chrome.title, "flex min-w-0 flex-1 items-center gap-2")}>
          <span className="truncate text-[13.5px] font-semibold text-ink">
            {showsTechnical ? "Fleet assistant" : "CaseRelay assistant"}
          </span>
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
