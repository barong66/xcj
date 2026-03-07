# Account Stats Tab (Funnel Metrics per Account)

> Date: 2026-03-07
> Status: Done
> ClickUp: https://app.clickup.com/t/869ccyz0e

## Goal

Add a Stats tab to the admin account detail page (/admin/accounts/:id) showing per-day funnel metrics for each account. The Stats tab is the default tab on the account page.

## Problem

Previously the account detail page in the admin panel only had Fan Site Links and Promo tabs. There was no way to see account-level analytics (how many profile views, clicks, conversions) without going to the global stats page and filtering manually.

## Solution

### New API endpoint

`GET /api/v1/admin/accounts/{id}/stats?days=30`

Returns per-day funnel metrics for the specified account over the given period (7, 30, or 90 days).

### Funnel metrics tracked

| Metric | Event Type | Description |
|--------|-----------|-------------|
| Profile Views | impression | Impressions of the account's videos |
| IG/Twitter Clicks | click | Clicks to original content (Instagram/Twitter) |
| Paid Site Clicks | social_click | Clicks to fan sites (OnlyFans, etc.) |
| Video Clicks | profile_thumb_click | Clicks on thumbnails on the model profile page |
| Sessions | (unique session_id) | Unique visitor sessions |
| Avg Session Duration | (computed) | Average session duration in seconds |

### Frontend: Stats tab UI

- Summary cards showing totals for the selected period
- Daily breakdown table with all funnel metrics
- Period selector: 7d / 30d / 90d
- Stats is the **default tab** on the account detail page

### No migrations needed

Uses existing `xcj.events` data in ClickHouse. No new tables or columns required.

## Files Changed

### API (Go)
- `api/internal/clickhouse/reader.go` -- new `GetAccountFunnelStats` method (ClickHouse query)
- `api/internal/handler/admin.go` -- new `GetAccountStats` handler
- `api/internal/handler/router.go` -- new route registration
- `api/internal/handler/admin_test.go` -- test for the new handler

### Frontend (Next.js)
- `web/src/lib/admin-api.ts` -- new types (`AccountFunnelDay`, `AccountFunnelStats`) + `getAccountStats()` function
- `web/src/app/admin/accounts/[id]/page.tsx` -- Stats tab UI (summary cards + daily table + period selector)
