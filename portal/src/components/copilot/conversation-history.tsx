"use client";

import {
  UseAgentUpdate,
  useAgent,
  useCopilotChatConfiguration,
} from "@copilotkit/react-core/v2";
import { useCallback, useEffect, useState } from "react";
import type { ButtonHTMLAttributes } from "react";
import { Icon } from "@/components/icons";
import { cx, row, type as type_ } from "@/design/tokens";
import { CASERELAY_AGENT_ID } from "@/lib/copilot/config";
import { useConversations } from "@/lib/copilot/conversations";

/**
 * Keeping and reopening conversations in the assistant panel.
 *
 * The SDK owns which thread is active — `startNewThread` and
 * `setActiveThreadId` on the chat configuration, both non-explicit so the
 * welcome screen returns and no server replay is attempted. What it does not
 * own is the transcript, so `ConversationBridge` files each one as it happens
 * and puts it back when a thread is reopened — whether the volunteer picked it
 * from the switcher or simply came back to a portal they had left open.
 */

/**
 * Shuttles transcripts between the agent and the conversation store. Renders
 * nothing, and is mounted as a leaf so the per-token re-render that drives the
 * capture stops here instead of reaching the panel.
 */
export function ConversationBridge() {
  const configuration = useCopilotChatConfiguration();
  const threadId = configuration?.threadId;
  const { agent } = useAgent({
    agentId: CASERELAY_AGENT_ID,
    updates: [UseAgentUpdate.OnMessagesChanged],
  });
  const { remember, recall, pendingRestoreId, claimRestore } = useConversations();

  // Pick up where the volunteer left off. The SDK mints a fresh thread on every
  // load, so continuing one is a switch to it: same non-explicit path a row in
  // the switcher takes, which the refill below then answers. Claimed first so a
  // volunteer who starts typing before the store is read is not interrupted by
  // a switch, and so this only ever happens once.
  useEffect(() => {
    if (!pendingRestoreId || !configuration) return;
    claimRestore();
    if (pendingRestoreId === threadId || agent.messages.length > 0) return;
    configuration.setActiveThreadId(pendingRestoreId, { explicit: false });
  }, [pendingRestoreId, claimRestore, configuration, threadId, agent]);

  // Refill a reopened thread. `CopilotChat` empties the agent whenever the
  // thread id changes, and the replay that would normally refill it exists
  // only on the Intelligence transport. So the refill is ours, and it has to
  // land after that clear: both are effects in the same commit and the order
  // between two components is tree order, which a microtask sidesteps because
  // React has finished flushing effects by the time one runs.
  useEffect(() => {
    if (!threadId) return;
    const kept = recall(threadId);
    if (!kept?.length) return;

    queueMicrotask(() => {
      // A second switch may have overtaken this one.
      if (agent.threadId !== threadId || agent.messages.length > 0) return;
      agent.setMessages(kept);
    });
  }, [threadId, agent, recall]);

  // File the live transcript. No dependency array on purpose: `useAgent`
  // re-renders this on every message change, so the store trails the agent by
  // one commit. Reading `agent.messages` rather than a notification payload is
  // what stops a queued clear from landing on top of a restore.
  useEffect(() => {
    if (threadId) remember(threadId, agent.messages);
  });

  return null;
}

/**
 * Ends the run in flight before the thread underneath it changes.
 *
 * Leaving it going corrupts both conversations. The SDK empties the agent on a
 * thread change, but a live run keeps pushing its own accumulated snapshot of
 * the messages, so the reply you walked away from reappears — now filed under
 * the conversation you just opened. Detaching closes the subject the event
 * stream is gated on, which stops it for both the ADK and built-in agents.
 *
 * `updates: []` keeps this hook from subscribing: it needs the agent, not a
 * re-render on every token.
 */
function useEndRunInFlight() {
  const { agent } = useAgent({ agentId: CASERELAY_AGENT_ID, updates: [] });

  return useCallback(async () => {
    if (!agent.isRunning) return;
    agent.abortRun();
    await agent.detachActiveRun();
  }, [agent]);
}

/** Matches the close control in `chat-parts`, which sets the header's rhythm. */
function HeaderButton({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink",
        className,
      )}
    />
  );
}

/** Clears the panel to a fresh thread. Nothing is discarded; it is filed. */
export function NewConversationButton() {
  const configuration = useCopilotChatConfiguration();
  const { setOpen } = useConversations();
  const endRunInFlight = useEndRunInFlight();

  return (
    <HeaderButton
      aria-label="New conversation"
      title="New conversation"
      onClick={async () => {
        setOpen(false);
        await endRunInFlight();
        configuration?.startNewThread();
      }}
    >
      <Icon name="plus" size={18} />
    </HeaderButton>
  );
}

export function ConversationHistoryButton() {
  const { isOpen, setOpen } = useConversations();

  return (
    <HeaderButton
      aria-label={isOpen ? "Hide earlier conversations" : "Earlier conversations"}
      title="Earlier conversations"
      aria-expanded={isOpen}
      onClick={() => setOpen(!isOpen)}
      className={cx(isOpen && "bg-surface-muted text-ink")}
    >
      <Icon name={isOpen ? "close" : "history"} size={18} />
    </HeaderButton>
  );
}

function timeAgo(timestamp: number): string {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

/**
 * The switcher, laid over the message list rather than beside it — a 492px
 * panel has no room for two columns.
 *
 * Positioned against the SDK's own `aside`, which is fixed and therefore the
 * containing block, so the list covers everything below the 64px header while
 * leaving the header's own controls reachable.
 */
/**
 * Two-step delete-everything. Its own component so the confirmation unmounts
 * with the panel: reopening the switcher should not find it halfway armed.
 */
function DeleteAllButton({ onConfirm }: { onConfirm: () => void }) {
  const [isConfirming, setConfirming] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        if (!isConfirming) {
          setConfirming(true);
          return;
        }
        setConfirming(false);
        onConfirm();
      }}
      className={cx(
        "mt-2 text-[11.5px] font-medium transition-colors",
        isConfirming ? "text-danger" : "text-ink-muted hover:text-danger",
      )}
    >
      {isConfirming ? "Delete every conversation?" : "Delete all"}
    </button>
  );
}

export function ConversationHistoryPanel() {
  const { conversations, isOpen, setOpen, forget, forgetAll } = useConversations();
  const configuration = useCopilotChatConfiguration();
  const endRunInFlight = useEndRunInFlight();
  const activeId = configuration?.threadId;

  if (!isOpen) return null;

  /**
   * Deleting the conversation on screen leaves the panel showing a transcript
   * with nothing behind it, so the chat is cleared to a new thread first.
   */
  const remove = async (id: string) => {
    if (id === activeId) {
      await endRunInFlight();
      configuration?.startNewThread();
    }
    forget(id);
  };

  return (
    <div className="animate-rise absolute inset-x-0 top-16 bottom-0 z-20 flex flex-col bg-surface">
      <div className="flex items-baseline justify-between px-4 pt-4 pb-2">
        <span className={type_.label}>Earlier conversations</span>
        <span className={type_.meta}>{conversations.length || "None"} kept</span>
      </div>

      {conversations.length === 0 ? (
        <p className={cx(type_.small, "px-4 py-2")}>
          Nothing kept yet. Ask something, and the conversation will be listed here so you can come
          back to it.
        </p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {conversations.map((conversation) => {
            const isActive = conversation.id === activeId;

            return (
              <li key={conversation.id} className="group relative">
                <button
                  type="button"
                  aria-current={isActive || undefined}
                  onClick={async () => {
                    setOpen(false);
                    if (isActive) return;
                    await endRunInFlight();
                    // Non-explicit: the SDK clears the panel and skips the
                    // server replay it cannot do, and the bridge refills it.
                    configuration?.setActiveThreadId(conversation.id, { explicit: false });
                  }}
                  className={cx(
                    "block w-full rounded-control py-2.5 pr-10 pl-2.5 text-left",
                    isActive ? row.selected : row.hover,
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[13px] leading-tight font-medium text-ink">
                      {conversation.title}
                    </span>
                    {isActive && (
                      <span className="shrink-0 text-[10.5px] font-medium text-brand-deep">
                        Open
                      </span>
                    )}
                  </span>
                  <span className={cx(type_.meta, "mt-1 block")}>
                    {conversation.turns} {conversation.turns === 1 ? "question" : "questions"} ·{" "}
                    {timeAgo(conversation.updatedAt)}
                  </span>
                </button>

                <button
                  type="button"
                  aria-label={`Delete conversation: ${conversation.title}`}
                  title="Delete"
                  onClick={() => void remove(conversation.id)}
                  className={cx(
                    "absolute top-1/2 right-1.5 inline-flex size-7 -translate-y-1/2 items-center",
                    "justify-center rounded-control text-ink-muted opacity-0 transition",
                    "hover:bg-danger-soft hover:text-danger focus-visible:opacity-100",
                    "group-hover:opacity-100",
                  )}
                >
                  <Icon name="trash" size={15} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="border-t border-line px-4 py-3">
        <p className="text-[11.5px] leading-relaxed text-ink-muted">
          Conversations are kept in this browser only — never in the case record — so the last one
          reopens when you come back. Delete any of them here.
        </p>

        {conversations.length > 0 && (
          <DeleteAllButton
            onConfirm={() =>
              void (async () => {
                await endRunInFlight();
                configuration?.startNewThread();
                forgetAll();
              })()
            }
          />
        )}
      </div>
    </div>
  );
}
