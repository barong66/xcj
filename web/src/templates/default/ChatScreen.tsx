"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createChatHistory, type ChatDisplayMessage, type CTAData } from "./chatHistory";
import { trackChatOpen, trackChatMessage, trackChatCTAClick } from "@/lib/analytics";

interface ChatScreenProps {
  slug: string;
  accountId: number;
  modelName: string;
  avatarUrl?: string;
  onClose: () => void;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export function ChatScreen({ slug, accountId, modelName, avatarUrl, onClose }: ChatScreenProps) {
  const [messages, setMessages] = useState<ChatDisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { getHistory, addMessage, getContextMessages } = createChatHistory(slug);

  // Load history + greeting on mount
  useEffect(() => {
    const history = getHistory();
    if (history.length > 0) {
      setMessages(history);
    } else {
      // Fetch greeting
      fetchGreeting();
    }
    trackChatOpen(slug, accountId);
    inputRef.current?.focus();
  }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchGreeting() {
    try {
      const res = await fetch(`${API_BASE}/api/v1/chat/config?slug=${encodeURIComponent(slug)}`);
      const json = await res.json();
      if (json.data?.greeting) {
        const greetMsg: ChatDisplayMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: json.data.greeting,
        };
        setMessages([greetMsg]);
        addMessage(greetMsg);
      }
    } catch {
      // No greeting — start with empty chat
    }
  }

  // Scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    setInput("");
    setError(null);

    // Capture context BEFORE adding user message to history (avoid duplicate in Grok context)
    const contextHistory = getContextMessages();

    const userMsg: ChatDisplayMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    addMessage(userMsg);

    // Track message sent
    trackChatMessage(slug, accountId);

    setStreaming(true);
    const assistantId = crypto.randomUUID();
    const assistantMsg: ChatDisplayMessage = { id: assistantId, role: "assistant", content: "" };
    setMessages((prev) => [...prev, assistantMsg]);

    try {
      const res = await fetch(`${API_BASE}/api/v1/chat/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model_slug: slug,
          message: text,
          history: contextHistory,
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error("Request failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = "";
      let cta: CTAData | undefined;

      let streamDone = false;
      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);

          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              setError(`${modelName} is unavailable right now, try again later.`);
              reader.cancel();
              streamDone = true;
              break;
            }
            if (parsed.done) {
              if (parsed.cta) cta = parsed.cta as CTAData;
              streamDone = true;
              break;
            }
            if (parsed.delta) {
              fullContent += parsed.delta;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, content: fullContent } : m
                )
              );
            }
          } catch {
            // skip malformed SSE event
          }
        }
      }

      // Finalize assistant message with CTA if present
      const finalMsg: ChatDisplayMessage = {
        id: assistantId,
        role: "assistant",
        content: fullContent,
        cta,
      };
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? finalMsg : m))
      );
      addMessage(finalMsg);
    } catch {
      setError("Something went wrong. Please try again.");
      setMessages((prev) => prev.filter((m) => m.id !== assistantId));
    } finally {
      setStreaming(false);
      inputRef.current?.focus();
    }
  }, [input, streaming, messages, slug, accountId, getContextMessages, addMessage]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function handleCTAClick(cta: CTAData) {
    trackChatCTAClick(slug, accountId, cta.url);
    window.open(cta.url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg" style={{ maxWidth: 430, margin: "0 auto" }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-bg-elevated border-b border-border shrink-0">
        <div className="relative shrink-0">
          <div className="w-9 h-9 rounded-full overflow-hidden bg-bg-card">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt={modelName} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-accent font-bold text-sm">
                {modelName.charAt(0).toUpperCase()}
              </div>
            )}
          </div>
          <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 rounded-full border border-bg-elevated" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-semibold text-txt truncate">{modelName}</p>
          <p className="text-[11px] text-green-500">● online now</p>
        </div>
        <button
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center text-txt-muted hover:text-txt rounded-full hover:bg-bg-card transition-colors"
          aria-label="Close chat"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className="max-w-[80%] space-y-2">
              <div
                className={`px-3 py-2 rounded-2xl text-[13px] leading-[1.5] ${
                  msg.role === "user"
                    ? "bg-accent text-white rounded-br-sm"
                    : "bg-bg-elevated text-txt rounded-bl-sm border border-border"
                }`}
              >
                {msg.content || (streaming && msg.role === "assistant" && messages[messages.length - 1]?.id === msg.id ? (
                  <span className="inline-flex gap-1">
                    <span className="w-1.5 h-1.5 bg-txt-muted rounded-full animate-bounce [animation-delay:0ms]" />
                    <span className="w-1.5 h-1.5 bg-txt-muted rounded-full animate-bounce [animation-delay:150ms]" />
                    <span className="w-1.5 h-1.5 bg-txt-muted rounded-full animate-bounce [animation-delay:300ms]" />
                  </span>
                ) : null)}
              </div>
              {msg.cta && (
                <button
                  onClick={() => handleCTAClick(msg.cta!)}
                  className="block w-full px-3 py-2 text-[12px] font-semibold text-accent border border-accent rounded-xl hover:bg-accent hover:text-white transition-colors text-left"
                >
                  {msg.cta.text} →
                </button>
              )}
            </div>
          </div>
        ))}
        {error && (
          <p className="text-center text-[12px] text-red-400 py-2">{error}</p>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-3 py-3 bg-bg-elevated border-t border-border shrink-0">
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${modelName}...`}
            rows={1}
            disabled={streaming}
            maxLength={1000}
            className="flex-1 bg-bg-card text-txt text-[13px] placeholder:text-txt-muted rounded-2xl px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-accent border border-border disabled:opacity-50"
            style={{ maxHeight: 80 }}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || streaming}
            className="w-9 h-9 shrink-0 flex items-center justify-center bg-accent text-white rounded-full disabled:opacity-40 hover:bg-accent/90 transition-colors"
            aria-label="Send message"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
