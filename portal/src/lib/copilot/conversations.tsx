"use client";

import type { Message } from "@ag-ui/client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  deleteAllConversations,
  deleteConversation,
  loadConversations,
  readLastThreadId,
  saveConversation,
  writeLastThreadId,
} from "@/lib/copilot/conversation-store";

/**
 * Kept conversations for the assistant panel.
 *
 * CopilotKit does ship durable threads, but they belong to the Intelligence
 * platform: `useThreads` needs list endpoints a plain `CopilotRuntime` never
 * exposes, `CopilotThreadsDrawer` renders an upgrade prompt without a licence
 * key, and reopening a stored thread runs through `connectAgent`, whose replay
 * is documented as a no-op for non-Intelligence transports. Neither CaseRelay
 * wiring — ADK over AG-UI — can replay a transcript, so the panel keeps its
 * own.
 *
 * It keeps them in this browser and nowhere else: an IndexedDB store on the
 * volunteer's own machine, never the case record and never the backend. That
 * buys back the conversation after a reload — including the one that was open,
 * which is reopened on the next visit — and makes deleting one a deliberate
 * act rather than a side effect of closing the tab.
 */

/** A row in the switcher. The transcript itself is deliberately not on here. */
export interface ConversationSummary {
  /** The CopilotKit thread id, which is what selecting a row switches to. */
  id: string;
  title: string;
  /** Questions asked, which is the only length worth showing at this size. */
  turns: number;
  updatedAt: number;
}

interface ConversationsContextValue {
  /** Most recently active first. */
  conversations: ConversationSummary[];
  isOpen: boolean;
  setOpen: (open: boolean) => void;
  /**
   * Files the live transcript under `id`. Called after every message change,
   * so it deliberately does not re-render on its own: the transcripts sit in a
   * ref, and only a change to a listed row's title or count touches state.
   */
  remember: (id: string, messages: Message[]) => void;
  recall: (id: string) => Message[] | undefined;
  /** Drops one conversation from the list, this tab, and the browser store. */
  forget: (id: string) => void;
  /** The same, for every conversation at once. */
  forgetAll: () => void;
  /**
   * The conversation that was open when the portal was last closed, offered
   * once so the panel can reopen it. Null once claimed, or when there is
   * nothing to go back to.
   */
  pendingRestoreId: string | null;
  claimRestore: () => void;
}

const ConversationsContext = createContext<ConversationsContextValue | null>(null);

/** Long enough to tell two questions apart, short enough for one line. */
const TITLE_LIMIT = 52;

/**
 * Streaming files the transcript on every token, so writes trail it rather
 * than following each one. Short enough that a reload right after a reply
 * still finds it.
 */
const WRITE_DELAY_MS = 500;

function titleFor(messages: Message[]): string {
  for (const message of messages) {
    if (message.role !== "user" || typeof message.content !== "string") continue;
    const text = message.content.trim().replace(/\s+/g, " ");
    if (!text) continue;
    return text.length > TITLE_LIMIT ? `${text.slice(0, TITLE_LIMIT - 1)}…` : text;
  }
  return "Untitled conversation";
}

export function ConversationsProvider({ children }: { children: ReactNode }) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [pendingRestoreId, setPendingRestoreId] = useState<string | null>(null);
  const transcripts = useRef(new Map<string, Message[]>());
  const summaries = useRef(new Map<string, ConversationSummary>());
  const unwritten = useRef(new Set<string>());
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActiveId = useRef<string | null>(null);

  const setOpen = useCallback((open: boolean) => setIsOpen(open), []);

  // Read the store back once, on mount. Anything the volunteer has already
  // said in this tab wins: the panel is live from the first render, and a
  // conversation started before the read lands is newer than what is on disk.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [stored, lastThreadId] = await Promise.all([loadConversations(), readLastThreadId()]);
      if (cancelled || stored.length === 0) return;

      for (const conversation of stored) {
        if (transcripts.current.has(conversation.id)) continue;
        transcripts.current.set(conversation.id, conversation.messages);
        summaries.current.set(conversation.id, {
          id: conversation.id,
          title: conversation.title,
          turns: conversation.turns,
          updatedAt: conversation.updatedAt,
        });
      }

      setConversations((current) => {
        const live = new Set(current.map((entry) => entry.id));
        const restored = stored
          .filter((entry) => !live.has(entry.id))
          .map(({ id, title, turns, updatedAt }) => ({ id, title, turns, updatedAt }));
        return [...current, ...restored].sort((a, b) => b.updatedAt - a.updatedAt);
      });

      if (lastThreadId && transcripts.current.has(lastThreadId)) {
        setPendingRestoreId(lastThreadId);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Writes are batched by id rather than queued per call, so a reply that
  // renders fifty times is one write of its finished transcript.
  const scheduleWrite = useCallback((id: string) => {
    unwritten.current.add(id);
    if (writeTimer.current) return;

    writeTimer.current = setTimeout(() => {
      writeTimer.current = null;
      const ids = [...unwritten.current];
      unwritten.current.clear();

      for (const each of ids) {
        const summary = summaries.current.get(each);
        const messages = transcripts.current.get(each);
        if (!summary || !messages?.length) continue;
        void saveConversation({ ...summary, messages });
      }
      if (lastActiveId.current) void writeLastThreadId(lastActiveId.current);
    }, WRITE_DELAY_MS);
  }, []);

  useEffect(
    () => () => {
      if (writeTimer.current) clearTimeout(writeTimer.current);
    },
    [],
  );

  const remember = useCallback(
    (id: string, messages: Message[]) => {
      // An empty thread is not history yet. Returning rather than dropping the
      // row matters: the panel is cleared before a restore lands, and deleting
      // on empty would flicker the conversation out of the list mid-switch.
      if (messages.length === 0) return;

      // The agent pushes into its own array, so a stored reference would keep
      // growing after the switch away from it.
      transcripts.current.set(id, [...messages]);

      const title = titleFor(messages);
      const turns = messages.reduce(
        (count, message) => count + (message.role === "user" ? 1 : 0),
        0,
      );
      const listed = summaries.current.get(id);
      const changed = !listed || listed.title !== title || listed.turns !== turns;

      summaries.current.set(id, {
        id,
        title,
        turns,
        updatedAt: changed ? Date.now() : (listed?.updatedAt ?? Date.now()),
      });
      lastActiveId.current = id;
      scheduleWrite(id);

      setConversations((current) => {
        // Streaming fires this on every delta with the same title and count.
        if (!changed && current.some((entry) => entry.id === id)) return current;
        const rest = current.filter((entry) => entry.id !== id);
        const summary = summaries.current.get(id);
        return summary ? [summary, ...rest] : current;
      });
    },
    [scheduleWrite],
  );

  const recall = useCallback((id: string) => transcripts.current.get(id), []);

  const forget = useCallback((id: string) => {
    transcripts.current.delete(id);
    summaries.current.delete(id);
    unwritten.current.delete(id);
    setConversations((current) => current.filter((entry) => entry.id !== id));
    void deleteConversation(id);

    if (lastActiveId.current === id) lastActiveId.current = null;
    void readLastThreadId().then((lastThreadId) => {
      if (lastThreadId === id) void writeLastThreadId(null);
    });
  }, []);

  const forgetAll = useCallback(() => {
    transcripts.current.clear();
    summaries.current.clear();
    unwritten.current.clear();
    lastActiveId.current = null;
    setConversations([]);
    void deleteAllConversations();
  }, []);

  const claimRestore = useCallback(() => setPendingRestoreId(null), []);

  const value = useMemo<ConversationsContextValue>(
    () => ({
      conversations,
      isOpen,
      setOpen,
      remember,
      recall,
      forget,
      forgetAll,
      pendingRestoreId,
      claimRestore,
    }),
    [
      conversations,
      isOpen,
      setOpen,
      remember,
      recall,
      forget,
      forgetAll,
      pendingRestoreId,
      claimRestore,
    ],
  );

  return <ConversationsContext.Provider value={value}>{children}</ConversationsContext.Provider>;
}

export function useConversations() {
  const context = useContext(ConversationsContext);
  if (!context) throw new Error("useConversations must be used inside ConversationsProvider");
  return context;
}
