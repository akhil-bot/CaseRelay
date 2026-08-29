import type { Message } from "@ag-ui/client";

/**
 * IndexedDB behind the assistant panel's conversation list.
 *
 * Kept dependency-free and deliberately forgiving: every call resolves even
 * when the database cannot be opened (server render, private browsing, a user
 * who has blocked storage). History is a convenience, so a portal that cannot
 * write one still works — the panel simply behaves as it did before, holding
 * conversations for the life of the tab.
 *
 * Transcripts are stored as JSON text rather than as objects. The structured
 * clone algorithm rejects anything the agent has hung off a message that is not
 * plain data, and one such message would otherwise fail the whole write.
 */

const DB_NAME = "caserelay-copilot";
const DB_VERSION = 1;
const CONVERSATIONS = "conversations";
const META = "meta";
const LAST_THREAD_KEY = "lastThreadId";

/** Enough to scroll back through a shift; old ones are dropped on load. */
const KEEP = 40;

export interface StoredConversation {
  id: string;
  title: string;
  turns: number;
  updatedAt: number;
  messages: Message[];
}

interface ConversationRow {
  id: string;
  title: string;
  turns: number;
  updatedAt: number;
  /** `Message[]`, serialised. */
  transcript: string;
}

let databasePromise: Promise<IDBDatabase | null> | null = null;

function openDatabase(): Promise<IDBDatabase | null> {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }

    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(CONVERSATIONS)) {
        database.createObjectStore(CONVERSATIONS, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(META)) {
        database.createObjectStore(META);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });

  return databasePromise;
}

function run<T>(
  storeName: string,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return openDatabase().then(
    (database) =>
      new Promise<T | null>((resolve) => {
        if (!database) {
          resolve(null);
          return;
        }
        try {
          const transaction = database.transaction(storeName, mode);
          const request = work(transaction.objectStore(storeName));
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve(null);
          transaction.onabort = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

/**
 * Every kept conversation, most recently updated first, with anything past
 * {@link KEEP} pruned as it is read.
 */
export async function loadConversations(): Promise<StoredConversation[]> {
  const rows = await run<ConversationRow[]>(CONVERSATIONS, "readonly", (store) =>
    store.getAll() as IDBRequest<ConversationRow[]>,
  );
  if (!rows?.length) return [];

  const ordered = [...rows].sort((a, b) => b.updatedAt - a.updatedAt);
  for (const stale of ordered.slice(KEEP)) void deleteConversation(stale.id);

  const conversations: StoredConversation[] = [];
  for (const row of ordered.slice(0, KEEP)) {
    try {
      const messages = JSON.parse(row.transcript) as Message[];
      if (!Array.isArray(messages) || messages.length === 0) continue;
      conversations.push({
        id: row.id,
        title: row.title,
        turns: row.turns,
        updatedAt: row.updatedAt,
        messages,
      });
    } catch {
      void deleteConversation(row.id);
    }
  }
  return conversations;
}

export async function saveConversation(conversation: StoredConversation): Promise<void> {
  let transcript: string;
  try {
    transcript = JSON.stringify(conversation.messages);
  } catch {
    return;
  }

  const row: ConversationRow = {
    id: conversation.id,
    title: conversation.title,
    turns: conversation.turns,
    updatedAt: conversation.updatedAt,
    transcript,
  };
  await run(CONVERSATIONS, "readwrite", (store) => store.put(row));
}

export async function deleteConversation(id: string): Promise<void> {
  await run(CONVERSATIONS, "readwrite", (store) => store.delete(id));
}

export async function deleteAllConversations(): Promise<void> {
  await run(CONVERSATIONS, "readwrite", (store) => store.clear());
  await writeLastThreadId(null);
}

/** The conversation the panel was last on, reopened on the next visit. */
export async function readLastThreadId(): Promise<string | null> {
  const id = await run<string | undefined>(META, "readonly", (store) =>
    store.get(LAST_THREAD_KEY) as IDBRequest<string | undefined>,
  );
  return typeof id === "string" ? id : null;
}

export async function writeLastThreadId(id: string | null): Promise<void> {
  await run<IDBValidKey | undefined>(META, "readwrite", (store) =>
    id === null
      ? (store.delete(LAST_THREAD_KEY) as IDBRequest<IDBValidKey | undefined>)
      : (store.put(id, LAST_THREAD_KEY) as IDBRequest<IDBValidKey | undefined>),
  );
}
