# Chat Visual Redesign (Instagram DM Style) — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the chat widget to match Instagram DM visual design — bottom sheet layout, gradient user bubbles, Instagram-like header with avatar + "Active now", slide-up animation.

**Architecture:** Pure frontend visual change. Only `ChatScreen.tsx` is modified — all logic (SSE streaming, history, analytics, CTA handling) stays identical. `ChatButton.tsx` gets a minor update to support close animation state.

**Tech Stack:** React 18, Tailwind CSS, inline styles for gradient/animation

**Spec:** `docs/superpowers/specs/2026-03-26-chat-visual-redesign-design.md`

---

## Chunk 1: Chat Visual Overhaul

### Task 1: Rewrite ChatScreen layout — bottom sheet with backdrop and animations

**Files:**
- Modify: `web/src/templates/default/ChatScreen.tsx` (complete rewrite of JSX + add animation state)
- Modify: `web/src/templates/default/ChatButton.tsx` (support closing animation before unmount)

**Context for implementer:**
- Current `ChatScreen.tsx` (287 lines): self-contained component with all chat logic (SSE streaming, message state, history, CTA handling). ALL logic must be preserved exactly. Only the JSX return block and some state additions change.
- Current `ChatButton.tsx` (43 lines): renders a button + portal with `ChatScreen`. Needs a small change to delay unmount during close animation.
- Tailwind config at `web/tailwind.config.ts` defines theme colors (`bg`, `txt`, `accent`, `border`). For the Instagram redesign, we use hardcoded Instagram colors (`#000`, `#262626`, `#8E8E8E`) instead of theme tokens — this is intentional to match Instagram exactly.
- `chatHistory.ts` — no changes needed.

**What the redesigned ChatScreen looks like:**
1. **Backdrop** — fixed overlay `bg-black/50`, fades in/out
2. **Bottom sheet panel** — slides up from bottom, 85vh height, max-width 430px, `border-radius: 16px 16px 0 0`, background `#000`
3. **Header** — chevron-down close button (left), avatar 32px with green dot (center-left), name bold + "Active now" gray subtitle, border-bottom `#262626`
4. **Messages** — model messages left with 28px avatar + `#262626` bubble, user messages right with purple→blue gradient bubble. CTA as `#262626` pill button below model bubble. Typing dots in gray bubble. Timestamps centered between messages.
5. **Input** — `#262626` rounded-full pill, "Message..." placeholder in `#8E8E8E`, send button only visible when text entered
6. **Animations** — slide-up/down panel (300ms/200ms), backdrop fade, message fade-in (150ms)

- [ ] **Step 1: Update ChatButton to support close animation**

In `web/src/templates/default/ChatButton.tsx`, the current flow is: `open=true` → render ChatScreen, `open=false` → unmount. We need to keep ChatScreen mounted during the close animation, then unmount after it finishes.

Replace the entire file content with:

```tsx
"use client";

import { useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { ChatScreen } from "./ChatScreen";
import type { Account } from "@/types";

interface ChatButtonProps {
  account: Account;
}

export function ChatButton({ account }: ChatButtonProps) {
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);

  if (!account.chat_enabled) return null;

  const slug = account.slug || account.username;

  const handleOpen = useCallback(() => {
    setOpen(true);
    setVisible(true);
  }, []);

  const handleClose = useCallback(() => {
    setVisible(false);
    // Keep mounted during exit animation, then unmount
    setTimeout(() => setOpen(false), 250);
  }, []);

  return (
    <>
      <button
        onClick={handleOpen}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full bg-accent text-white hover:bg-accent/90 transition-colors shrink-0"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" />
        </svg>
        Chat
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <ChatScreen
          slug={slug}
          accountId={account.id}
          modelName={account.display_name || account.username}
          avatarUrl={account.avatar_url}
          onClose={handleClose}
          visible={visible}
        />,
        document.body
      )}
    </>
  );
}
```

Key changes: added `visible` state prop, `handleClose` delays unmount by 250ms for exit animation.

- [ ] **Step 2: Rewrite ChatScreen.tsx with Instagram DM styling**

Replace the entire `web/src/templates/default/ChatScreen.tsx` with the following. ALL business logic (streaming, SSE parsing, history, CTA, analytics) is preserved exactly — only the JSX, styling, and animation state change.

```tsx
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
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
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

  // Swipe down to close
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
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

    panel.addEventListener("touchstart", onTouchStart, { passive: true });
    panel.addEventListener("touchmove", onTouchMove, { passive: true });
    panel.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      panel.removeEventListener("touchstart", onTouchStart);
      panel.removeEventListener("touchmove", onTouchMove);
      panel.removeEventListener("touchend", onTouchEnd);
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
        .ig-msg-new { animation: igFadeIn 150ms ease-out forwards; }
      `}</style>

      {/* Bottom Sheet Panel */}
      <div
        ref={panelRef}
        className="relative w-full flex flex-col transition-transform duration-300"
        style={{
          maxWidth: 430,
          height: "85vh",
          backgroundColor: "#000",
          borderRadius: "16px 16px 0 0",
          transform: visible ? "translateY(0)" : "translateY(100%)",
          transitionTimingFunction: visible ? "cubic-bezier(0.32,0.72,0,1)" : "ease-in",
          transitionDuration: visible ? "300ms" : "200ms",
        }}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-2 pb-0">
          <div style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: "#3a3a3a" }} />
        </div>

        {/* Header */}
        <div
          className="flex items-center gap-3 px-4 shrink-0"
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
            <p className="font-semibold text-white truncate" style={{ fontSize: 15 }}>{modelName}</p>
            <p style={{ fontSize: 12, color: "#8E8E8E" }}>Active now</p>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4" style={{ backgroundColor: "#000" }}>
          <div className="flex flex-col gap-2">
            {/* Timestamp at start of conversation */}
            {messages.length > 0 && (
              <p className="text-center py-2" style={{ fontSize: 11, color: "#8E8E8E" }}>
                {formatTime(new Date())}
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
                          <span className="rounded-full animate-bounce" style={{ width: 6, height: 6, backgroundColor: "#8E8E8E", animationDelay: "0ms" }} />
                          <span className="rounded-full animate-bounce" style={{ width: 6, height: 6, backgroundColor: "#8E8E8E", animationDelay: "150ms" }} />
                          <span className="rounded-full animate-bounce" style={{ width: 6, height: 6, backgroundColor: "#8E8E8E", animationDelay: "300ms" }} />
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
```

- [ ] **Step 3: Verify the build compiles**

Run: `cd web && npx next build 2>&1 | tail -20`
Expected: Build succeeds with no TypeScript errors.

If there are type errors (e.g. `visible` prop not recognized), fix them before proceeding.

- [ ] **Step 4: Manual visual verification**

Start dev server: `cd web && npm run dev`

Open a model page with `chat_enabled=true` and verify:
1. Chat button opens bottom sheet sliding up from bottom
2. Backdrop darkens behind the panel
3. Header shows chevron-down, avatar with green dot, name + "Active now"
4. Model messages appear left with avatar + gray bubble
5. User messages appear right with purple→blue gradient
6. Input is a rounded pill with `#8E8E8E` placeholder, send button appears only when typing
7. Closing (chevron-down or backdrop click) slides panel down smoothly
8. Swipe down on mobile closes the panel
9. New messages fade in with subtle animation
10. Timestamp displayed at top of conversation

- [ ] **Step 5: Commit**

```bash
git add web/src/templates/default/ChatScreen.tsx web/src/templates/default/ChatButton.tsx
git commit -m "feat(chat): redesign to Instagram DM style — bottom sheet, gradient bubbles, slide animation"
```
