# Admin Panel Redesign — Design Spec

**Date:** 2026-03-14
**Status:** Approved
**Scope:** Full structural redesign of the admin panel — navigation, new sections, UX improvements.

---

## Background

The admin panel was built organically without an upfront plan. Each feature was added in isolation, resulting in a flat 10-item sidebar with no hierarchy and inconsistent UX patterns. This redesign establishes a clean structure based on actual usage patterns.

**User's daily workflow priority:**
1. Check traffic / conversions stats
2. Manage ads (banners/promo)
3. Add accounts, monitor parsing
4. Configure sites
5. Check queue errors

---

## Navigation Structure

**Pattern:** Grouped sidebar (variant A) — sections organized under labeled group headers.

```
OVERVIEW
  └── Dashboard

ANALYTICS
  ├── Traffic
  └── Revenue

CONTENT
  ├── Accounts
  ├── Videos
  └── Queue

ADS
  ├── Promo
  └── Sources

SITES
  ├── Websites
  └── Categories

SYSTEM
  └── Health
```

**Key principle:** Accounts are global (one account feeds multiple sites). Site-specific data (analytics, settings) uses a site selector dropdown. No site selector in Content section.

---

## Section Designs

### Overview → Dashboard

**Layout:** Site cards as the primary element (not global aggregate stats).

- **Alert bar** at top — shown only when there are queue errors, links to Queue → Failed
- **Site cards grid** — one card per site showing: domain, status badge, traffic 7d, conversions 7d, CTR. Sites with errors highlighted in red.
- **Bottom widgets** — queue status (pending/running/failed counts) + content totals (accounts, videos)
- **No "Quick Actions"** buttons on dashboard — moved to their respective sections

### Analytics → Traffic

**Layout:** Site selector dropdown + period toggle (7d/30d/90d) + tabs.

**Tabs:**
- **Overview** — bar chart (sessions by day), top sources mini-table, top countries mini-table, conversions summary
- **By Source** — table grouped by source with all metrics
- **By Country** — table grouped by country
- **By Device** — table grouped by device type + OS + browser

Summary metric cards (Sessions, Impressions, Clicks, CTR) always visible above tabs.

### Analytics → Revenue

**New section** (currently stats live inside Promo → Statistics).

- Chart: conversions by day (7d/30d/90d, per site)
- Funnel table by ad source: Impressions → Clicks → Landings → Conversions → CTR → Conv%
- Recent postbacks table with status filter (sent / failed / pending), retry on failed

### Content → Accounts

No changes from current implementation. Existing features: list with filters, bulk import (Instagram usernames + Twitter keyword search), account detail page, reparse.

### Content → Videos

No changes from current implementation.

### Content → Queue

**Improvement:** Failed tab opens first when there are failed jobs.

- Tabs: **Failed** (default if count > 0) / Running / Pending / Done
- Each failed row shows: account username, error message inline (no expanding needed), Retry button
- "Retry All Failed" button in header

### Ads → Promo

Renamed from "Banners" to "Promo" to accommodate future ad formats beyond banners.

- Banner sizes management (add/remove sizes)
- Banner gallery (paginated)
- Embed code generator with source + style selector, copy JS / copy URL buttons, live preview iframe

### Ads → Sources

Split out from Promo → Settings.

- Ad sources list (name, postback URL, status)
- Add/enable/disable sources
- CPA pricing per account (currently in account detail page — keep there, link from here)
- Conversion tracking documentation (event types, URL placeholders)

### Sites → Websites

**List page:** Add traffic 7d column. Click → site detail page.

**Site detail page** with tabs:
- **Settings** — site name, domain, template selector, CSS variables (accent color, font), active/inactive toggle
- **Content** — enabled categories for this site, linked accounts
- **Banners** — active banner sizes for this site, embed code snippet

### Sites → Categories

No changes from current implementation.

### System → Health

No changes from current implementation.

---

## What Gets Removed / Consolidated

| Old | New |
|-----|-----|
| `/admin/content` (empty page) | Removed |
| `/admin/finder` (separate page) | Merged into Accounts → Bulk Import (already there) |
| Promo → Statistics tab | Moved to Analytics → Revenue |
| Promo → Performance tab | Moved to Analytics → Revenue (or removed if low usage) |
| Promo → Settings tab | Becomes Ads → Sources |

---

## Technical Notes

- Existing routes under `/admin/*` need to be reorganized but the API routes (`/api/v1/admin/*`) stay unchanged
- Site selector state should be persisted in URL params (`?site=temptguide.com`) for bookmarkability
- The `AdminShell` sidebar groups need label headers — add `group` field to `navItems`
- Analytics charts: use a lightweight library (Recharts already in Next.js ecosystem) or pure SVG — no heavy dependencies
- Revenue section reads from existing ClickHouse `mv_banner_daily` and postbacks tables

---

## Out of Scope (Future)

- Revenue / earnings tracking (no revenue data yet)
- Per-site account assignment UI (accounts are currently global)
- User management / multiple admin users
