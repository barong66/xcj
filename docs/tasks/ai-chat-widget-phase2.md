# AI Chat Widget — Phase 2 (Frontend)

> Status: **Complete** (2026-03-26)
> PR: https://github.com/barong66/xcj/pull/2
> ClickUp: https://app.clickup.com/t/869cmbugc
> Depends on: Phase 1 (Backend) — PR #1, https://app.clickup.com/t/869cmbu95

---

## Overview

Frontend implementation of the AI chat widget feature. Adds a chat button to model profile pages that opens a full-screen chat interface with SSE streaming responses from the xAI Grok API (proxied through the Go backend).

## What Was Implemented

### Public-facing Components

1. **ChatButton** (`web/src/templates/default/ChatButton.tsx`)
   - Floating chat button rendered via `createPortal` to document.body
   - Only visible when `account.chat_enabled === true`
   - Opens ChatScreen overlay on click
   - Fires `chat_open` analytics event

2. **ChatScreen** (`web/src/templates/default/ChatScreen.tsx`)
   - Full-screen chat overlay with message bubbles
   - SSE streaming from `POST /api/v1/chat/{accountId}`
   - Typing indicator during AI response
   - Auto-scroll to latest message
   - Ad text CTA rendering (from `chat_ad_text` account field)
   - Error handling with retry capability
   - Fires `chat_message` and `chat_cta_click` analytics events

3. **chatHistory** (`web/src/templates/default/chatHistory.ts`)
   - localStorage persistence utility
   - Stores up to 50 messages per account
   - Returns last 20 messages as context for API calls
   - Key format: `chat_history_{accountId}`

4. **ProfileHeader integration** (`web/src/templates/default/ProfileHeader.tsx`)
   - ChatButton mounted inside ProfileHeader when chat is enabled

### Admin Panel

5. **Chat Settings tab** (`web/src/app/admin/accounts/[id]/page.tsx`)
   - New tab on account detail page
   - Toggle for `chat_enabled`
   - Textarea for custom `chat_prompt` (system prompt)
   - Textarea for `chat_ad_text` (CTA text injected by AI)

6. **AdminAccount type** (`web/src/lib/admin-api.ts`)
   - Extended with `chat_enabled`, `chat_prompt`, `chat_ad_text` fields

### Analytics

7. **Event types** (`web/src/types/index.ts`)
   - Added to `AnalyticsEventType`: `chat_open`, `chat_message`, `chat_cta_click`

8. **Helper functions** (`web/src/lib/analytics.ts`)
   - `trackChatOpen(accountId)` — fired when chat overlay opens
   - `trackChatMessage(accountId)` — fired when user sends a message
   - `trackChatCTAClick(accountId)` — fired when user clicks the ad CTA

## Files Created

| File | Description |
|------|-------------|
| `web/src/templates/default/ChatButton.tsx` | Floating chat button component |
| `web/src/templates/default/ChatScreen.tsx` | Full-screen chat UI with SSE |
| `web/src/templates/default/chatHistory.ts` | localStorage persistence utility |

## Files Modified

| File | Changes |
|------|---------|
| `web/src/types/index.ts` | Added `chat_enabled` to Account, chat event types to AnalyticsEventType |
| `web/src/lib/analytics.ts` | Added trackChatOpen, trackChatMessage, trackChatCTAClick helpers |
| `web/src/templates/default/ProfileHeader.tsx` | Integrated ChatButton |
| `web/src/lib/admin-api.ts` | Extended AdminAccount with chat fields |
| `web/src/app/admin/accounts/[id]/page.tsx` | Added Chat Settings tab |

## Dependencies

- **Phase 1 (Backend)** must be merged first — provides:
  - Migration 017: `chat_enabled`, `chat_prompt`, `chat_ad_text` columns on `accounts`
  - `POST /api/v1/chat/{accountId}` SSE endpoint
  - `PUT /admin/accounts/{id}` accepting chat fields
  - `XAI_API_KEY` environment variable for Grok API

## Follow-up Tasks

- Apply migration 017 to production (https://app.clickup.com/t/869cn0kdz)
- Deploy AI Chat Widget to production (https://app.clickup.com/t/869cn0kf9)
