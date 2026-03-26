# Chat Visual Redesign — Instagram DM Style

**Date:** 2026-03-26
**Status:** Approved

## Overview

Redesign the AI chat widget to match Instagram Direct Messages visual style. The chat is a bottom sheet panel overlaying the model's profile page, with Instagram-like message bubbles, header, and input area.

## Format: Bottom Sheet Panel

- Slides up from bottom, covers ~85% of viewport height
- Animation: `translateY(100%) → translateY(0)` over 300ms ease-out
- Backdrop: semi-transparent dark overlay (fade-in)
- Dismiss: chevron-down button in header OR swipe down gesture
- Max width: 430px, centered on desktop
- Border-radius: `16px 16px 0 0` on the panel top corners

## Header

- Background: `#000000`
- **Left:** Chevron-down icon (close button), white, ~24px
- **Center-left:** Model avatar (32px circle) with green online indicator dot (10px, bottom-right, `#00D26A` with 2px dark border)
- **Text block:** Model name in bold white (15px), "Active now" below in gray `#8E8E8E` (12px)
- **Bottom border:** 1px solid `#262626`
- Height: ~56px with vertical centering

## Messages Area

- Background: `#000000`
- Scrollable, flex-column, gap between message groups
- Auto-scroll to bottom on new messages

### Model messages (left-aligned)
- Small avatar (28px circle) to the left, bottom-aligned with last bubble in group
- Bubble background: `#262626`
- Text color: `#FFFFFF`, font-size 14px
- Border-radius: `18px` with `border-bottom-left-radius: 4px` on last bubble in group
- Max width: 75% of container
- Padding: `8px 12px`

### User messages (right-aligned)
- No avatar
- Background: `linear-gradient(to right, #6C5CE7, #0095F6)` (Instagram purple→blue gradient)
- Text color: `#FFFFFF`, font-size 14px
- Border-radius: `18px` with `border-bottom-right-radius: 4px` on last bubble in group
- Max width: 75% of container
- Padding: `8px 12px`

### CTA buttons
- Rendered below model's message bubble
- Style: inline button with `#262626` background, 1px border `#363636`, rounded-full
- Text: white, 13px, with `→` arrow
- On tap: opens link in new tab

### Typing indicator
- Positioned as a model message (left, with avatar)
- Gray bubble `#262626` with three animated dots
- Dots: `#8E8E8E`, 6px circles, bouncing with staggered delays (0ms, 150ms, 300ms)

### Timestamps
- Centered, `#8E8E8E`, 11px
- Shown between message groups (not every message)
- Format: "HH:MM" or "Today HH:MM"

## Input Area

- Background: `#000000`
- Top border: 1px solid `#262626`
- Input field: `#262626` background, rounded-full (24px radius), white text, 14px
- Placeholder: "Message..." in `#8E8E8E`
- Send button: arrow icon, appears only when input has text, accent gradient or white
- Padding bottom: `env(safe-area-inset-bottom)` for mobile notch devices
- Height: ~48px content area + safe area padding

## Animations

- **Panel entrance:** slide-up `translateY(100% → 0)`, 300ms ease-out
- **Panel exit:** slide-down `translateY(0 → 100%)`, 200ms ease-in
- **Backdrop:** opacity `0 → 0.5`, synced with panel animation
- **New messages:** subtle fade-in (opacity 0→1, 150ms)
- **Typing dots:** bounce animation with `@keyframes` (translateY 0 → -4px → 0)

## Greeting Message

- Model's first message (greeting from Grok API) displayed as a regular model message bubble
- No special styling — same as any assistant message

## What Changes

| Component | Current | New |
|-----------|---------|-----|
| Layout | Fixed fullscreen overlay | Bottom sheet, 85% height |
| Header | Basic with close X | Instagram-style with avatar + "Active now" |
| Model messages | `bg-bg-elevated` with border | `#262626`, no border, avatar outside bubble |
| User messages | `bg-accent` solid | Purple→blue gradient |
| Input | Textarea, always visible send | Rounded pill input, conditional send button |
| Animations | None (instant show) | Slide-up + backdrop fade |
| Dismiss | X button only | Chevron-down + swipe down |

## What Stays the Same

- SSE streaming via Grok API
- localStorage chat history
- CTA extraction and rendering
- Analytics events (chat_open, chat_message, chat_cta_click)
- Portal rendering to document.body
- ChatButton trigger (floating button)
- All backend logic unchanged

## Files to Modify

- `web/src/templates/default/ChatScreen.tsx` — complete visual overhaul
- `web/src/templates/default/ChatButton.tsx` — no changes expected (triggers ChatScreen)
- `web/src/templates/default/chatHistory.ts` — no changes expected
