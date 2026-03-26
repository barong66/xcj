"use client";

const MAX_MESSAGES = 50;
const CONTEXT_MESSAGES = 20;
const KEY_PREFIX = "chat_history_";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CTAData {
  text: string;
  url: string;
}

export interface ChatDisplayMessage extends ChatMessage {
  id: string;  // for React key
  cta?: CTAData;
}

function storageKey(slug: string): string {
  return KEY_PREFIX + slug;
}

export function createChatHistory(slug: string) {
  function getHistory(): ChatDisplayMessage[] {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(storageKey(slug));
      if (!raw) return [];
      return JSON.parse(raw) as ChatDisplayMessage[];
    } catch {
      return [];
    }
  }

  function addMessage(msg: ChatDisplayMessage): void {
    const history = getHistory();
    history.push(msg);
    // Trim to max
    const trimmed = history.slice(-MAX_MESSAGES);
    try {
      localStorage.setItem(storageKey(slug), JSON.stringify(trimmed));
    } catch {
      // localStorage full — clear history and drop this message
      localStorage.removeItem(storageKey(slug));
    }
  }

  function clearHistory(): void {
    try {
      localStorage.removeItem(storageKey(slug));
    } catch {
      // ignore
    }
  }

  // Returns last CONTEXT_MESSAGES as API-compatible messages (without id/cta)
  function getContextMessages(): ChatMessage[] {
    return getHistory()
      .slice(-CONTEXT_MESSAGES)
      .map(({ role, content }) => ({ role, content }));
  }

  return { getHistory, addMessage, clearHistory, getContextMessages };
}
