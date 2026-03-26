# AI Chat Widget — Design Spec

**Date:** 2026-03-25
**Status:** Approved

## Overview

Add an AI chat widget to model profile pages (`/model/[slug]`). The widget impersonates the model and acts as a monetization funnel — engaging users with flirtatious conversation while naturally inserting CTAs (OnlyFans links, ads, social links, etc.).

The AI agent is powered by **Grok (xAI API)**, proxied through the Go API with SSE streaming for a real-time chat feel.

---

## User Flow

1. User visits `/model/sophia-rose`
2. Sees **"💬 Chat"** button in the profile header (next to model name)
3. Taps → full-screen chat overlay opens
4. Greeting message from "Sophia" appears (AI-generated opening line)
5. User chats; agent responds with streaming text (word by word)
6. Agent naturally inserts CTAs when conversation is warm (OnlyFans link, ad message, etc.)
7. History persists in localStorage across sessions (keyed by model slug)
8. Tap ✕ to return to model page

---

## Grok API Configuration

- **Endpoint:** `https://api.x.ai/v1/chat/completions` (OpenAI-compatible format)
- **Model:** `grok-3`
- **API key:** `XAI_API_KEY` environment variable
- **Timeout:** 10 seconds
- **Max tokens per response:** 300 (keep responses short)
- **Context window:** last 20 messages from history (client trims before sending)
- **Greeting generation:** single Grok call on `GET /chat/config`; result cached in Redis for 24h per slug. Fallback if Grok fails: `"Hey! 😊 What's up?"`

---

## Architecture

```
[/model/slug page]
  └─ ChatButton (shows if chat_enabled=true)
       ↓ tap
  └─ ChatScreen (full-screen overlay, Client Component)
       ├─ GET /api/v1/chat/config?slug=sophia-rose   (initial greeting)
       └─ POST /api/v1/chat/message                  (SSE stream)
            ↓
       [Go API]
         - Load account from DB (name, country, categories, social links, chat_prompt)
         - Build system prompt
         - Call xAI Grok API
         - Stream tokens back via SSE
         - Track chat_message event in ClickHouse
```

---

## Database Migration (017)

**File:** `scripts/migrations/017_chat_settings.sql`

```sql
ALTER TABLE accounts ADD COLUMN chat_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE accounts ADD COLUMN chat_prompt TEXT;
ALTER TABLE accounts ADD COLUMN chat_ad_text TEXT;
```

- `chat_enabled` — whether chat is shown for this model (default: off)
- `chat_prompt` — custom system prompt override (NULL = auto-generate)
- `chat_ad_text` — custom ad message text (NULL = agent uses social links from DB)

---

## Go API Endpoints

### `GET /api/v1/chat/config?slug={slug}`

Returns initial chat config for a model. Generates an opening greeting via Grok.

**Response:**
```json
{
  "data": {
    "enabled": true,
    "model_name": "Sophia Rose",
    "greeting": "Hey! So glad you stopped by... 😊"
  },
  "status": "ok"
}
```

### `POST /api/v1/chat/message`

Sends a user message and streams the agent's response via SSE.

**Request:**
```json
{
  "model_slug": "sophia-rose",
  "message": "Hi!",
  "history": [
    {"role": "assistant", "content": "Hey! So glad you stopped by 😊"},
    {"role": "user", "content": "Hi!"}
  ]
}
```

**Response (SSE stream):**
```
data: {"delta": "Hey"}
data: {"delta": " there"}
data: {"delta": "!"}
data: {"done": true, "cta": {"text": "Check my OF 💜", "url": "https://onlyfans.com/..."}}
```

The final `done` event optionally includes a `cta` object when the agent decides to insert a promotional link. The agent signals this via a structured JSON tag in its response that the API detects and strips before streaming:

**Grok response format (raw):** Grok is instructed to append a CTA tag on a new line when promoting a link:
```
Tell me about yourself 😊 [CTA:{"text":"Check my OnlyFans 💜","url":"https://onlyfans.com/sophia"}]
```

The Go API scans the response stream, extracts any `[CTA:{...}]` tag, parses the JSON, strips the tag from the streamed text, and includes the parsed CTA in the final `done` SSE event.

**Error handling:**
- Grok unavailable / timeout (10s) → `data: {"error": "unavailable"}` — frontend shows "Sophia is unavailable right now, try again later"
- Malformed CTA tag → skip CTA silently, still stream the text
- Stream interrupted mid-response → frontend shows partial message + retry button

### System Prompt Construction

```
You are {name}, a {country} model and content creator.
Your personality: flirty, fun, confident, a little mysterious.
Categories you're known for: {categories}.

You are chatting with a fan on your website. Keep responses short (1-3 sentences).
Be engaging and personal. Use occasional emojis.

Your social links (use naturally in conversation when it feels right):
- OnlyFans: {onlyfans_url}
- Instagram: {instagram_url}
- Twitter: {twitter_url}

{custom_prompt_if_set}

When the conversation feels warm and engaged, naturally mention one of your links or
insert this promotion: "{chat_ad_text}". Don't be pushy — make it feel organic.
```

If `chat_prompt` is set in DB, it **replaces** the entire auto-generated prompt above.

---

## Frontend Components

All files in `web/src/templates/default/`:

### `ChatButton.tsx`
- Client Component
- Props: `{ slug: string, chatEnabled: boolean }`
- Renders "💬 Chat" button in model profile header
- Hidden if `chatEnabled = false`
- On click: mounts `ChatScreen`

### `ChatScreen.tsx`
- Client Component, full-screen overlay (fixed, z-50, dark background)
- Header: avatar + model name + "● online" + ✕ close button
- Messages area: scrollable, model bubbles (left, purple bg) + user bubbles (right, magenta)
- CTA cards: rendered inline as special message type (clickable card with link)
- Input: textarea + Send button
- On mount: loads history from localStorage, fetches greeting if no history
- On send: appends to history, calls POST /chat/message, SSE-reads response token by token
- On close: unmounts, returns to model page

### `useChatHistory.ts`
- Custom hook for localStorage management
- `getHistory(slug): Message[]`
- `addMessage(slug, message: Message): void`
- `clearHistory(slug): void`
- Max 50 messages; trims oldest when limit reached
- Last 20 messages sent to API as context

### Integration Point
- `web/src/app/model/[slug]/page.tsx` — add `<ChatButton>` to profile header
- Profile page fetches chat config alongside model data

---

## Admin Panel Changes

Add "Chat" section to model edit page in admin:

**Fields:**
- **Chat enabled** — toggle (default: off)
- **Custom prompt** — textarea (placeholder: "Leave empty to auto-generate from model data")
- **Ad message** — textarea (placeholder: "Leave empty — agent will use model's social links")

**API change:** extend `PATCH /api/admin/accounts/{id}` to accept and save the 3 new fields:
```json
{
  "chat_enabled": true,
  "chat_prompt": "You are Sophia, a fun and flirty...",
  "chat_ad_text": "Check out my exclusive content 💜"
}
```
Validation: `chat_prompt` max 2000 chars, `chat_ad_text` max 500 chars.

---

## Analytics (ClickHouse)

New events tracked via existing analytics infrastructure:

| Event | When |
|-------|------|
| `chat_open` | User opens ChatScreen |
| `chat_message` | User sends a message (count messages, not content) |
| `chat_cta_click` | User clicks a CTA link inside chat |

---

## CTAs Supported

The agent can promote any of the following (configured via system prompt + model data):

1. OnlyFans referral link
2. Instagram / Twitter profile
3. Telegram / Discord channel
4. External ad offer (via `chat_ad_text` field)
5. Internal model recommendations ("You might also like...")
6. Soft paywall nudge ("See my exclusive content on OnlyFans 💜")

---

## Out of Scope

- Media/photo sharing by the agent (future iteration)
- Email/push capture within chat (future iteration)
- Per-session chat analytics dashboard (future iteration)
- Multiple language personas (future iteration)
