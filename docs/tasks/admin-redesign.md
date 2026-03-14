# Admin Panel Redesign

**Date:** 2026-03-14
**Status:** Completed

---

## What Was Built

Full restructure of the Next.js admin panel: grouped sidebar navigation, new analytics and ads pages, improved dashboard, and better UX across all admin sections.

### Changed Files

| File | Change |
|------|--------|
| `web/src/app/admin/AdminShell.tsx` | Grouped sidebar: 6 groups (Overview, Analytics, Content, Ads, Sites, System) |
| `web/src/app/admin/page.tsx` | Dashboard redesigned: per-site cards + alert bar for queue failures |
| `web/src/app/admin/analytics/traffic/page.tsx` | New Traffic page: site selector + 4 tabs (Overview/Source/Country/Device) |
| `web/src/app/admin/analytics/revenue/page.tsx` | New Revenue page: banner funnel + postbacks |
| `web/src/app/admin/ads/promo/page.tsx` | New Promo page: banner gallery + embed codes |
| `web/src/app/admin/ads/sources/page.tsx` | New Sources page: ad sources CRUD + postback config |
| `web/src/app/admin/queue/page.tsx` | Auto-defaults to Failed tab when errors exist |
| `web/src/app/admin/websites/page.tsx` | Traffic 7d column added |
| `web/src/app/admin/websites/[id]/page.tsx` | Added Content + Banners tabs |
| `web/src/app/admin/stats/page.tsx` | Redirect to /admin/analytics/traffic |
| `web/src/app/admin/promo/page.tsx` | Redirect to /admin/ads/promo |
| `web/src/lib/admin-api.ts` | Added getDashboardSites(), DashboardSite type, site_id param for traffic |
| `api/internal/handler/admin_dashboard.go` | New GET /api/v1/admin/dashboard/sites endpoint |
| `api/internal/clickhouse/reader.go` | GetSiteTrafficStats method |
| `api/internal/handler/router.go` | Registered new /admin/dashboard/sites route |

### New Navigation Structure

```
Overview
  Dashboard (/admin)
Analytics
  Traffic (/admin/analytics/traffic)
  Revenue (/admin/analytics/revenue)
Content
  Accounts (/admin/accounts)
  Videos (/admin/videos)
  Content (/admin/content)
  Categories (/admin/categories)
Ads
  Promo (/admin/ads/promo)
  Sources (/admin/ads/sources)
Sites
  Websites (/admin/websites)
System
  Queue (/admin/queue)
  Health (/admin/health)
```

### New API Endpoint

`GET /api/v1/admin/dashboard/sites` — returns per-site metrics for the dashboard:
- video_count, account_count
- views_7d, clicks_7d, ctr_7d (from ClickHouse)

Implemented in `api/internal/handler/admin_dashboard.go` using `GetSiteTrafficStats` from `api/internal/clickhouse/reader.go`.

### Backward Compatibility

Old routes redirect to new locations:
- `/admin/stats` → `/admin/analytics/traffic`
- `/admin/promo` → `/admin/ads/promo`

---

## Key Design Decisions

- **Grouped sidebar** — 6 semantic groups instead of flat list. Makes admin easier to navigate as feature count grows
- **Per-site dashboard** — dashboard now shows metrics per site rather than aggregated totals, enabling quick health check across all managed sites
- **Alert bar** — queue failure count prominently shown on dashboard, auto-opens Failed tab in Queue page
- **Traffic Explorer kept intact** — existing traffic analytics logic preserved, just reorganized under /admin/analytics/traffic with a new site selector and tabbed UI
- **Separate Revenue page** — banner funnel and postback data moved to dedicated /admin/analytics/revenue (was nested inside old /admin/promo)
- **Ads group** — Promo (banner gallery) and Sources (ad network management) grouped together logically
- **Redirect pages** — old /admin/stats and /admin/promo kept as thin redirect pages so bookmarks don't break

---

## Design Spec

`docs/superpowers/specs/2026-03-14-admin-redesign-design.md`

## Implementation Plan

`docs/superpowers/plans/2026-03-14-admin-redesign.md`

---

## Known TODOs

- **Revenue page site_id filter** — `getDashboardSites()` passes site_id to traffic stats, but `getBannerFunnel()` and `getPostbacks()` in admin-api.ts don't yet support site_id filtering. Revenue page currently shows aggregate data across all sites
- **Website detail Content tab** — Content tab on /admin/websites/[id] is scaffolded but needs per-site category enable/disable toggle implementation
- **Admin layout wrappers** — `web/src/app/admin/analytics/` and `web/src/app/admin/ads/` route groups don't have layout.tsx wrapper files. Currently relies on AdminShell in each page component. Layout files would reduce boilerplate
