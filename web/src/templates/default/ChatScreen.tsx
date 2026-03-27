"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createChatHistory, type ChatDisplayMessage, type CTAData } from "./chatHistory";
import { trackChatOpen, trackChatMessage, trackChatCTAClick } from "@/lib/analytics";

interface ChatScreenProps {
  slug: string;
  accountId: number;
  modelName: string;
  avatarUrl?: string;
  onClose: () => void;
  visible: boolean;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

/** Format timestamp for display between message groups */
function formatTime(date: Date): string {
  const now = new Date();
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const isToday = date.toDateString() === now.toDateString();
  return isToday ? `Today ${hours}:${minutes}` : `${hours}:${minutes}`;
}

export function ChatScreen({ slug, accountId, modelName, avatarUrl, onClose, visible }: ChatScreenProps) {
  const [messages, setMessages] = useState<ChatDisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messageCount, setMessageCount] = useState(0); // tracks count for fade-in
  const mountTime = useRef(new Date());
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { getHistory, addMessage, getContextMessages } = useMemo(
    () => createChatHistory(slug),
    [slug]
  );

  // Load history + greeting on mount
  useEffect(() => {
    const history = getHistory();
    if (history.length > 0) {
      setMessages(history);
      setMessageCount(history.length);
    } else {
      (async () => {
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
            setMessageCount(1);
            addMessage(greetMsg);
          }
        } catch {
          // No greeting — start with empty chat
        }
      })();
    }
    trackChatOpen(slug, accountId);
    inputRef.current?.focus();
  }, [slug, accountId, getHistory, addMessage]);

  // Scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Track message count for fade-in animation
  useEffect(() => {
    if (messages.length > messageCount) {
      setMessageCount(messages.length);
    }
  }, [messages.length, messageCount]);

  // Swipe down to close (only from header/drag-handle area)
  useEffect(() => {
    const header = headerRef.current;
    const panel = panelRef.current;
    if (!header || !panel) return;
    let startY = 0;
    let currentY = 0;

    function onTouchStart(e: TouchEvent) {
      startY = e.touches[0].clientY;
      currentY = startY;
    }
    function onTouchMove(e: TouchEvent) {
      currentY = e.touches[0].clientY;
      const delta = currentY - startY;
      if (delta > 0 && panel) {
        panel.style.transform = `translateY(${delta}px)`;
      }
    }
    function onTouchEnd() {
      const delta = currentY - startY;
      if (delta > 100) {
        onClose();
      } else if (panel) {
        panel.style.transform = "";
      }
    }

    header.addEventListener("touchstart", onTouchStart, { passive: true });
    header.addEventListener("touchmove", onTouchMove, { passive: true });
    header.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      header.removeEventListener("touchstart", onTouchStart);
      header.removeEventListener("touchmove", onTouchMove);
      header.removeEventListener("touchend", onTouchEnd);
    };
  }, [onClose]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    setInput("");
    setError(null);

    const contextHistory = getContextMessages();

    const userMsg: ChatDisplayMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    addMessage(userMsg);

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
      let hasError = false;
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
              hasError = true;
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

      if (hasError) {
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
      } else {
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
      }
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
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 transition-opacity duration-300"
        style={{
          backgroundColor: "rgba(0,0,0,0.5)",
          opacity: visible ? 1 : 0,
        }}
        onClick={onClose}
      />

      {/* Scoped styles for placeholder and fade-in animation */}
      <style>{`
        .ig-chat-input::placeholder { color: #8E8E8E; opacity: 1; }
        @keyframes igFadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes igDotBounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
        .ig-msg-new { animation: igFadeIn 150ms ease-out forwards; }
      `}</style>

      {/* Bottom Sheet Panel */}
      <div
        ref={panelRef}
        className="relative w-full flex flex-col"
        style={{
          maxWidth: 430,
          height: "85vh",
          backgroundColor: "#000",
          borderRadius: "16px 16px 0 0",
          transform: visible ? "translateY(0)" : "translateY(100%)",
          transitionProperty: "transform",
          transitionTimingFunction: visible ? "cubic-bezier(0.32,0.72,0,1)" : "ease-in",
          transitionDuration: visible ? "300ms" : "200ms",
        }}
      >
        {/* Drag handle + Header (swipe target) */}
        <div ref={headerRef} className="shrink-0">
          <div className="flex justify-center pt-2 pb-0">
            <div style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: "#3a3a3a" }} />
          </div>
          <div
            className="flex items-center gap-3 px-4"
            style={{ height: 52, borderBottom: "1px solid #262626" }}
          >
          {/* Close button */}
          <button
            onClick={onClose}
            className="shrink-0 flex items-center justify-center"
            style={{ width: 32, height: 32 }}
            aria-label="Close chat"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>

          {/* Avatar */}
          <div className="relative shrink-0">
            <div className="overflow-hidden rounded-full" style={{ width: 32, height: 32, backgroundColor: "#262626" }}>
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt={modelName} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-white font-bold text-sm">
                  {modelName.charAt(0).toUpperCase()}
                </div>
              )}
            </div>
            <span
              className="absolute rounded-full"
              style={{
                width: 10,
                height: 10,
                backgroundColor: "#00D26A",
                border: "2px solid #000",
                bottom: -1,
                right: -1,
              }}
            />
          </div>

          {/* Name + status */}
          <div className="flex-1 min-w-0">
            <p className="font-bold text-white truncate" style={{ fontSize: 15 }}>{modelName}</p>
            <p style={{ fontSize: 12, color: "#8E8E8E" }}>Active now</p>
          </div>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4" style={{ backgroundColor: "#000" }}>
          <div className="flex flex-col gap-2">
            {/* Timestamp at start of conversation */}
            {messages.length > 0 && (
              <p className="text-center py-2" style={{ fontSize: 11, color: "#8E8E8E" }}>
                {formatTime(mountTime.current)}
              </p>
            )}

            {messages.map((msg, idx) => {
              const isUser = msg.role === "user";
              const isEmpty = !msg.content;
              const isLastMsg = idx === messages.length - 1;
              const isStreamingThis = streaming && isLastMsg && msg.role === "assistant";
              // Apply fade-in animation only to newly added messages
              const isNew = idx >= messageCount - 1 && messageCount > 1;

              return (
                <div
                  key={msg.id}
                  className={`flex ${isUser ? "justify-end" : "justify-start"} items-end gap-2 ${isNew ? "ig-msg-new" : ""}`}
                >
                  {/* Model avatar */}
                  {!isUser && (
                    <div className="shrink-0 overflow-hidden rounded-full" style={{ width: 28, height: 28, backgroundColor: "#262626" }}>
                      {avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={avatarUrl} alt={modelName} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-white font-bold" style={{ fontSize: 11 }}>
                          {modelName.charAt(0).toUpperCase()}
                        </div>
                      )}
                    </div>
                  )}

                  <div style={{ maxWidth: "75%" }} className="space-y-2">
                    <div
                      className="text-white"
                      style={{
                        padding: "8px 12px",
                        fontSize: 14,
                        lineHeight: 1.45,
                        borderRadius: isUser ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                        ...(isUser
                          ? { background: "linear-gradient(to right, #6C5CE7, #0095F6)" }
                          : { backgroundColor: "#262626" }
                        ),
                      }}
                    >
                      {isEmpty && isStreamingThis ? (
                        <span className="inline-flex gap-1 items-center" style={{ height: 20 }}>
                          <span className="rounded-full" style={{ width: 6, height: 6, backgroundColor: "#8E8E8E", animation: "igDotBounce 0.6s infinite ease-in-out" }} />
                          <span className="rounded-full" style={{ width: 6, height: 6, backgroundColor: "#8E8E8E", animation: "igDotBounce 0.6s infinite ease-in-out 0.15s" }} />
                          <span className="rounded-full" style={{ width: 6, height: 6, backgroundColor: "#8E8E8E", animation: "igDotBounce 0.6s infinite ease-in-out 0.3s" }} />
                        </span>
                      ) : (
                        msg.content
                      )}
                    </div>

                    {/* CTA Button */}
                    {msg.cta && (
                      <button
                        onClick={() => handleCTAClick(msg.cta!)}
                        className="w-full text-left text-white font-semibold hover:opacity-80 transition-opacity"
                        style={{
                          padding: "8px 12px",
                          fontSize: 13,
                          backgroundColor: "#262626",
                          border: "1px solid #363636",
                          borderRadius: 9999,
                        }}
                      >
                        {msg.cta.text} →
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {error && (
              <p className="text-center py-2" style={{ fontSize: 12, color: "#FF4444" }}>{error}</p>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Input Area */}
        <div
          className="shrink-0 px-3 flex items-center gap-2"
          style={{
            borderTop: "1px solid #262626",
            backgroundColor: "#000",
            paddingTop: 8,
            paddingBottom: "max(8px, env(safe-area-inset-bottom))",
          }}
        >
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message..."
            disabled={streaming}
            maxLength={1000}
            className="ig-chat-input flex-1 text-white focus:outline-none disabled:opacity-50"
            style={{
              backgroundColor: "#262626",
              borderRadius: 9999,
              padding: "10px 16px",
              fontSize: 14,
              border: "none",
            }}
          />
          {input.trim() && (
            <button
              onClick={sendMessage}
              disabled={streaming}
              className="shrink-0 flex items-center justify-center disabled:opacity-40"
              style={{ width: 36, height: 36 }}
              aria-label="Send message"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" fill="#0095F6" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
