"use client";

import type { Message } from "@ag-ui/client";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

/**
 * Kept conversations for the assistant panel, held for the life of the tab.
 *
 * CopilotKit does ship durable threads, but they belong to the Intelligence
 * platform: `useThreads` needs list endpoints a plain `CopilotRuntime` never
 * exposes, `CopilotThreadsDrawer` renders an upgrade prompt without a licence
 * key, and reopening a stored thread runs through `connectAgent`, whose replay
 * is documented as a no-op for non-Intelligence transports. Neither CaseRelay
 * wiring — ADK over AG-UI — cannot replay a
 * transcript, so the panel keeps its own.
 *
 * It keeps them in memory and nowhere else. A transcript here is a child's
 * case read back to whoever opens the panel next, and the rest of this surface
 * already refuses to let that settle anywhere: no attachments, no feedback
 * posting, nothing written to a log. So history lives exactly as long as the
 * tab does — no localStorage, no sessionStorage, gone on reload.
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
}

const ConversationsContext = createContext<ConversationsContextValue | null>(null);

/** Long enough to tell two questions apart, short enough for one line. */
const TITLE_LIMIT = 52;

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
  const transcripts = useRef(new Map<string, Message[]>());

  const setOpen = useCallback((open: boolean) => setIsOpen(open), []);

  const remember = useCallback((id: string, messages: Message[]) => {
    // An empty thread is not history yet. Returning rather than dropping the
    // row matters: the panel is cleared before a restore lands, and deleting
    // on empty would flicker the conversation out of the list mid-switch.
    if (messages.length === 0) return;

    // The agent pushes into its own array, so a stored reference would keep
    // growing after the switch away from it.
    transcripts.current.set(id, [...messages]);

    const title = titleFor(messages);
    const turns = messages.reduce((count, message) => count + (message.role === "user" ? 1 : 0), 0);

    setConversations((current) => {
      const listed = current.find((entry) => entry.id === id);
      // Streaming fires this on every delta with the same title and count.
      if (listed && listed.title === title && listed.turns === turns) return current;
      const rest = current.filter((entry) => entry.id !== id);
      return [{ id, title, turns, updatedAt: Date.now() }, ...rest];
    });
  }, []);

  const recall = useCallback((id: string) => transcripts.current.get(id), []);

  const value = useMemo<ConversationsContextValue>(
    () => ({ conversations, isOpen, setOpen, remember, recall }),
    [conversations, isOpen, setOpen, remember, recall],
  );

  return <ConversationsContext.Provider value={value}>{children}</ConversationsContext.Provider>;
}

export function useConversations() {
  const context = useContext(ConversationsContext);
  if (!context) throw new Error("useConversations must be used inside ConversationsProvider");
  return context;
}
