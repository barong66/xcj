# Banner Metrics & Analytics System

> Status: DONE
> Module: api/internal/handler/banner.go, api/internal/handler/ua.go, api/internal/clickhouse/buffer.go, api/internal/clickhouse/reader.go, web/src/app/admin/promo/page.tsx
> Created: 2026-03-07
> Completed: 2026-03-07

---

## Overview

Комплексная система метрик и аналитики баннеров: серверный парсинг User-Agent, клиентский сбор контекста (устройство, экран, соединение, UTM), performance beacons (viewability, dwell time, load times), ClickHouse хранение с materialized views, административный дашборд с overview/device breakdown/referrer stats.

## Architecture

```
Баннер на стороннем сайте (iframe)
  |
  +-- loader.js собирает клиентский контекст
  |     screen, viewport, language, connection, UTM, referrer, page URL
  |
  +-- /b/serve?sw=1920&sh=1080&vw=800&vh=600&lang=en-US&conn=4g&...
  |     Go API: enrichEvent()
  |       - Серверный UA parsing (ua.go): browser, OS, device_type
  |       - Клиентские params из query string
  |     -> ClickHouse events (14 новых колонок)
  |
  +-- JS в HTML-шаблоне баннера собирает performance метрики:
  |     - image_load_ms (Image.onload)
  |     - render_ms (DOMContentLoaded)
  |     - time_to_visible_ms (IntersectionObserver, threshold 0.5)
  |     - dwell_time_ms (общее время видимости)
  |     - hover_duration_ms (mouseenter/mouseleave)
  |     - is_viewable (IAB: >=50% видимо >= 1 сек)
  |
  +-- beforeunload / visibilitychange -> sendBeacon -> POST /b/perf
        Go API -> InsertPerfEvent() -> ClickHouse banner_perf
```

## Implementation Details

### 1. User-Agent Parsing (ua.go)

**File:** `api/internal/handler/ua.go`
**Tests:** `api/internal/handler/ua_test.go`
**Dependency:** `github.com/mssola/useragent`

Three functions:
- `parseBrowser(ua string) string` -- returns browser name (Chrome, Firefox, Safari, Edge, Opera, Samsung Browser, UC Browser, Other)
- `parseOS(ua string) string` -- returns OS (Windows, macOS, Linux, Android, iOS, Chrome OS, Other)
- `parseDeviceType(ua string) string` -- returns device type based on:
  - `ua.Mobile()` -> mobile (unless tablet keywords present)
  - Keywords: "iPad", "Tablet", "Tab" -> tablet
  - `ua.Bot()` -> bot
  - Fallback -> desktop

### 2. Event Enrichment (enrichEvent)

**File:** `api/internal/handler/banner.go`

`enrichEvent(e *model.Event, r *http.Request)` fills 14 new fields on the Event struct:

Server-side (from HTTP request):
- `Browser`, `OS`, `DeviceType` -- from UA parsing
- `Referrer` -- from Referer header
- `IP` -- from X-Real-IP / X-Forwarded-For

Client-side (from query params, populated by loader.js):
- `ScreenWidth`, `ScreenHeight` (sw, sh)
- `ViewportWidth`, `ViewportHeight` (vw, vh)
- `Language` (lang)
- `ConnectionType` (conn)
- `PageURL` (page)
- `UTMSource`, `UTMMedium`, `UTMCampaign`

### 3. Event Model Extensions

**File:** `api/internal/model/event.go`

14 new fields added to Event struct:
```go
Browser        string
OS             string
DeviceType     string
ScreenWidth    int
ScreenHeight   int
ViewportWidth  int
ViewportHeight int
Language       string
ConnectionType string
PageURL        string
Country        string
UTMSource      string
UTMMedium      string
UTMCampaign    string
```

New PerfEvent struct for performance beacons:
```go
type PerfEvent struct {
    BannerID        int64  `json:"banner_id"`
    VideoID         int64  `json:"video_id"`
    AccountID       int64  `json:"account_id"`
    ImageLoadMs     int    `json:"image_load_ms"`
    RenderMs        int    `json:"render_ms"`
    TimeToVisibleMs int    `json:"ttv_ms"`
    DwellTimeMs     int    `json:"dwell_ms"`
    HoverDurationMs int    `json:"hover_ms"`
    IsViewable      bool   `json:"viewable"`
}
```

### 4. ClickHouse Buffer Extensions

**File:** `api/internal/clickhouse/buffer.go`

- `Insert()` extended: INSERT now includes 14 new columns alongside original columns
- `InsertPerfEvent()` -- new method: inserts PerfEvent into `banner_perf` table with UA context from request

### 5. Performance Beacon Endpoint

**File:** `api/internal/handler/banner.go`
**Route:** `POST /b/perf` (public, no auth)

- Accepts JSON body (from sendBeacon)
- Parses PerfEvent from request body
- Enriches with server-side context (UA, IP)
- Calls `InsertPerfEvent()` to write to ClickHouse `banner_perf`
- Returns 204 No Content

### 6. Client-Side Performance Tracking (banner templates)

**File:** `api/internal/handler/banner_templates.go`

All 4 banner templates (bold, elegant, minimalist, card) updated with JavaScript:

- `BannerID`, `VideoID`, `AccountID`, `PerfURL` added to template data struct
- IntersectionObserver (threshold 0.5) for IAB viewability tracking
- `performance.now()` for render time measurement
- Image `onload` for image load time
- `mouseenter` / `mouseleave` for hover duration tracking
- Dwell time accumulation while banner is visible
- `beforeunload` + `visibilitychange` triggers `sendBeacon` to `/b/perf`

### 7. Admin ClickHouse Queries

**File:** `api/internal/clickhouse/reader.go`

New methods:
- `GetPerfSummary(days int)` -- AVG(image_load_ms), AVG(render_ms), AVG(dwell_time_ms), SUM(is_viewable)/COUNT(*) from banner_perf
- `GetDeviceBreakdown(days int)` -- GROUP BY device_type, browser, os from events WHERE event_type IN ('banner_impression', 'banner_click')
- `GetReferrerStats(days int)` -- GROUP BY referrer, COUNT(*), TOP N from events

### 8. Admin API Handlers

**File:** `api/internal/handler/admin.go`

New handlers:
- `GetPerfSummary` -- GET /admin/perf-summary?days=N
- `GetDeviceBreakdown` -- GET /admin/device-breakdown?days=N
- `GetReferrerStats` -- GET /admin/referrer-stats?days=N

### 9. Router Registration

**File:** `api/internal/handler/router.go`

New routes:
- `POST /b/perf` -- public (in banner routes group)
- `GET /admin/perf-summary` -- admin auth required
- `GET /admin/device-breakdown` -- admin auth required
- `GET /admin/referrer-stats` -- admin auth required

### 10. Frontend Admin API

**File:** `web/src/lib/admin-api.ts`

New TypeScript interfaces:
```typescript
interface PerfSummary {
    avg_image_load_ms: number;
    avg_render_ms: number;
    avg_dwell_time_ms: number;
    viewability_rate: number;
    total_events: number;
}

interface DeviceBreakdown {
    device_type: string;
    browser: string;
    os: string;
    total_events: number;
}

interface ReferrerStat {
    referrer: string;
    total_events: number;
}
```

New API functions:
- `fetchPerfSummary(days: number)`
- `fetchDeviceBreakdown(days: number)`
- `fetchReferrerStats(days: number)`

### 11. Frontend Performance Tab

**File:** `web/src/app/admin/promo/page.tsx`

New "Performance" tab in Promo section with:
- **Overview Cards**: avg image load, avg render, viewability %, avg dwell time
- **Device Breakdown**: table with device_type, browser, OS, total events
- **Top Referrers**: table with referrer URL, total events
- **Period Selector**: 7d / 30d / 90d

## Database Changes

### ClickHouse Migration (012_clickhouse_banner_metrics.sql)

1. **14 new columns on `events` table:**
   - browser, os, device_type (LowCardinality)
   - screen_width, screen_height, viewport_width, viewport_height (UInt16)
   - language, connection_type (LowCardinality)
   - page_url, country (String/LowCardinality)
   - utm_source, utm_medium, utm_campaign (String)

2. **New `banner_perf` table:**
   - banner_id, video_id, account_id, site_id
   - Performance: image_load_ms, render_ms, time_to_visible_ms, dwell_time_ms, hover_duration_ms, is_viewable
   - Context: browser, os, device_type, screen_width, screen_height, connection_type, country
   - MergeTree, partitioned by month, TTL 6 months

3. **New `mv_banner_perf_daily` materialized view:**
   - AggregatingMergeTree (uses state functions: avgState, quantileState, countState, sumState)
   - ORDER BY (event_date, banner_id, device_type)
   - Aggregates: avg load/render/dwell, p95 load/render, viewable count

4. **New `mv_events_device_daily` materialized view:**
   - SummingMergeTree
   - ORDER BY (event_date, event_type, device_type, browser, os)
   - Aggregates: count per device/browser/OS combination

## Files Changed

### Created
| File | Description |
|------|-------------|
| `scripts/migrations/012_clickhouse_banner_metrics.sql` | ClickHouse migration: 14 new events columns + banner_perf table + 2 materialized views |
| `api/internal/handler/ua.go` | User-Agent parsing (browser, OS, device type) |
| `api/internal/handler/ua_test.go` | Tests for UA parsing |
| `api/internal/handler/admin_test.go` | Tests for enrichEvent, HandlePerfBeacon, AdminAuth, DeactivateBanner, GetAccountStats, DeleteAccount |

### Modified
| File | Description |
|------|-------------|
| `api/internal/model/event.go` | 14 new fields on Event + PerfEvent struct |
| `api/internal/clickhouse/buffer.go` | Extended INSERT with 14 columns + InsertPerfEvent() |
| `api/internal/clickhouse/reader.go` | GetPerfSummary, GetDeviceBreakdown, GetReferrerStats |
| `api/internal/handler/banner.go` | enrichEvent(), HandlePerfBeacon, updated loader.js context collection |
| `api/internal/handler/banner_templates.go` | BannerID/VideoID/AccountID/PerfURL in template data, perf tracking JS in all 4 templates |
| `api/internal/handler/admin.go` | GetPerfSummary, GetDeviceBreakdown, GetReferrerStats handlers |
| `api/internal/handler/router.go` | /b/perf public route + 3 admin routes |
| `api/internal/handler/banner_test.go` | Updated TestBannerTemplateRender with new struct fields |
| `web/src/lib/admin-api.ts` | PerfSummary, DeviceBreakdown, ReferrerStat interfaces + API functions |
| `web/src/app/admin/promo/page.tsx` | Performance tab with overview cards, device breakdown, top referrers |

## Deploy Notes

Migration 012 needs to be applied on the server:
```bash
# Apply ClickHouse migration
cat scripts/migrations/012_clickhouse_banner_metrics.sql | docker exec -i traforama-clickhouse clickhouse-client --multiquery
```

Then redeploy the application:
```bash
ssh traforama@37.27.189.122 "cd /opt/traforama/xcj && git pull origin main && docker compose -f deploy/docker/docker-compose.yml --env-file .env up -d --build"
```

## Testing

All Go tests pass:
```bash
cd api && go test ./...
```

Tests cover:
- UA parsing: browser detection, OS detection, device type classification
- enrichEvent: server-side UA parsing + client query param extraction
- HandlePerfBeacon: JSON parsing, response code
- Admin handlers: auth, deactivation, stats, delete

## Follow-up Tasks

- [ ] Deploy migration 012 on production server
- [ ] Monitor ClickHouse disk usage with new banner_perf table
- [ ] Add GeoIP lookup for country field (currently empty, prepared for future)
- [ ] Consider adding real-time performance alerts (e.g., image load > 5s threshold)
