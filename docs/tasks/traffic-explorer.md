# Traffic Explorer in Admin Stats

> Status: DONE
> Module: api/internal/clickhouse/reader.go, api/internal/handler/admin.go, api/internal/handler/router.go, web/src/lib/admin-api.ts, web/src/app/admin/stats/page.tsx
> Created: 2026-03-07
> Completed: 2026-03-07

---

## Overview

Comprehensive Traffic Explorer added to the `/admin/stats` page. Provides flexible analytics with dynamic GROUP BY, secondary grouping, filterable dimensions, and 8 metrics. The stats page now has a tabbed layout with Traffic Explorer (default) and Video Stats tabs.

## Architecture

```
Admin -> /admin/stats -> Traffic Explorer tab (default)
  |
  +-- Frontend loads dimensions: GET /admin/traffic-stats/dimensions?days=N
  |     -> ClickHouse: DISTINCT values for 9 filterable dimensions
  |     -> Populates filter dropdown menus
  |
  +-- User selects group_by, filters, period
  |     -> GET /admin/traffic-stats?group_by=date&days=30&country=US&...
  |     -> Go API validates all params against whitelists
  |     -> Builds dynamic SQL from whitelist-only expressions
  |     -> ClickHouse query with parameterized filter values
  |     -> Returns rows + summary
  |
  +-- Frontend renders:
        - Summary cards (total events, impressions, clicks, etc.)
        - Sortable data table with all 8 metrics
        - Column sort toggles (asc/desc)
```

## Implementation Details

### 1. ClickHouse Reader (reader.go)

**File:** `api/internal/clickhouse/reader.go`

Three whitelist maps protect against SQL injection:

**allowedDimensions** -- maps dimension names to SQL expressions:
| Key | SQL Expression |
|-----|---------------|
| date | `toString(toDate(created_at))` |
| source | `source` |
| referrer | `domain(referrer)` |
| country | `country` |
| device_type | `device_type` |
| os | `os` |
| browser | `browser` |
| event_type | `event_type` |
| utm_source | `utm_source` |
| utm_medium | `utm_medium` |
| utm_campaign | `utm_campaign` |

**allowedFilterColumns** -- maps filter names to safe SQL column references (same set minus date, plus referrer as `domain(referrer)`).

**allowedTrafficSorts** -- maps sort field names to safe SQL: total_events, impressions, clicks, profile_views, conversions, unique_sessions, ctr, conversion_rate, dimension1, dimension2.

**GetTrafficStats(ctx, TrafficStatsParams)** -> *TrafficStatsResult:
- Validates group_by and group_by2 against allowedDimensions
- Builds WHERE clause from filters (whitelist-checked columns + parameterized values)
- 8 metrics: count(), countIf for impressions/clicks/profile_views/conversions, uniq(session_id), CTR, conversion_rate
- LIMIT 500, configurable sort
- Computes summary row by aggregating all result rows

**GetTrafficDimensions(ctx, days)** -> []DimensionValues:
- Queries DISTINCT values for 9 filterable dimensions
- LIMIT 100 per dimension
- Graceful error handling per dimension (logs error, returns empty values)

### 2. Admin Handlers (admin.go)

**GetTrafficStats** -- `GET /api/v1/admin/traffic-stats`:
- Query params: group_by (required), group_by2 (optional), days (default 30), sort_by (default total_events), sort_dir (default desc)
- Additional query params used as filters: source, country, device_type, os, browser, event_type, utm_source, utm_medium, utm_campaign, referrer
- Returns TrafficStatsResult JSON

**GetTrafficDimensions** -- `GET /api/v1/admin/traffic-stats/dimensions`:
- Query param: days (default 30)
- Returns []DimensionValues JSON

### 3. Router (router.go)

Two new routes in admin group:
```go
r.Get("/traffic-stats", adminHandler.GetTrafficStats)
r.Get("/traffic-stats/dimensions", adminHandler.GetTrafficDimensions)
```

### 4. Frontend API Client (admin-api.ts)

**Types:**
- `TrafficStatsRow` -- dimension1, dimension2, total_events, impressions, clicks, profile_views, conversions, unique_sessions, ctr, conversion_rate
- `TrafficStatsResult` -- rows, summary, group_by, group_by2, days
- `DimensionValues` -- dimension, values[]
- `TrafficStatsParams` -- group_by, group_by2, days, sort_by, sort_dir, filters

**Functions:**
- `getTrafficStats(params)` -- fetches traffic stats
- `getTrafficDimensions(days)` -- fetches dimension values for filters

### 5. Stats Page UI (stats/page.tsx)

**Tabbed layout:**
- **Traffic Explorer** (default tab) -- full analytics interface
- **Video Stats** -- previous video stats table (preserved as-is)

**Traffic Explorer UI components:**
- Period selector: 7d / 30d / 90d buttons
- Group By dropdown (11 dimensions)
- Secondary Group By dropdown (optional)
- Dynamic filter dropdowns (values loaded from GetTrafficDimensions)
- Summary cards: Total Events, Impressions, Clicks, Profile Views, Conversions, Sessions, CTR, Conv Rate
- Sortable data table with column headers as sort toggles

## Security

SQL injection is prevented through three layers:
1. **Whitelist-only SQL construction** -- GROUP BY, SELECT, and ORDER BY expressions come exclusively from hardcoded maps
2. **Parameterized filter values** -- all user-provided filter values are passed as ClickHouse query parameters (?)
3. **Invalid dimension rejection** -- unknown group_by or group_by2 values return error before any SQL is executed

## Files Changed

| File | Change |
|------|--------|
| `api/internal/clickhouse/reader.go` | New whitelist maps, TrafficStatsParams/Row/Result types, GetTrafficStats(), GetTrafficDimensions() |
| `api/internal/handler/admin.go` | New GetTrafficStats, GetTrafficDimensions handlers |
| `api/internal/handler/router.go` | New routes: GET /traffic-stats, GET /traffic-stats/dimensions |
| `web/src/lib/admin-api.ts` | TypeScript types + fetch functions for traffic stats |
| `web/src/app/admin/stats/page.tsx` | Tabbed layout with Traffic Explorer + Video Stats |

## No Migration Required

Uses existing ClickHouse `events` table with its existing columns. No new tables or columns needed.
