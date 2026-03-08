# Ad Network Macro Params in Banner Flow

> Status: DONE
> Module: api/internal/handler/banner.go, web/src/components/AdLandingTracker.tsx, web/src/lib/analytics.ts, web/src/app/admin/promo/page.tsx
> Created: 2026-03-08

---

## Overview

Accept ad network macro parameters (ref_domain, original_ref, spot_id, node_id, auction_price, cpv_price, cpc, campaign_id, creative_id) through the full banner serve -> click -> landing -> event pipeline. Store all params in the events `extra` JSON field in ClickHouse. Admin embed code generator auto-includes all macros with ad-network-specific placeholders for easy copy-paste.

## Problem

When buying traffic from ad networks, the network provides macro placeholders (e.g., `%REFDOMAIN%`, `%SPOTID%`, `%CAMPAIGNID%`) that get replaced with actual values at serve time. These values are critical for:
- Understanding which placements/campaigns/creatives perform best
- Tracking auction prices and CPV/CPC for ROI calculations
- Correlating events back to specific ad network zones/spots

Previously, only `src` (source name) and `click_id` were propagated. Ad network macro params were not captured.

## Supported Parameters

| Parameter | data-* attribute | Description |
|-----------|-----------------|-------------|
| `ref_domain` | `data-ref-domain` | Referrer domain |
| `original_ref` | `data-original-ref` | Original referrer |
| `spot_id` | `data-spot-id` | Ad placement/spot ID |
| `node_id` | `data-node-id` | Network node ID |
| `auction_price` | `data-auction-price` | Auction clearing price |
| `cpv_price` | `data-cpv-price` | CPV (cost per view) price |
| `cpc` | `data-cpc` | CPC (cost per click) price |
| `campaign_id` | `data-campaign-id` | Campaign ID |
| `creative_id` | `data-creative-id` | Creative ID |

## Implementation

### Go API (`api/internal/handler/banner.go`)

**New helper functions:**
- `readAdNetworkParams(r *http.Request) map[string]string` -- reads all 9 ad network params from query string
- `bannerExtra(bannerID int64, clickID string, adParams map[string]string) string` -- builds extra JSON with banner_id, click_id, and all ad network params
- `appendAdNetworkParams(params url.Values, adParams map[string]string)` -- adds ad params to URL values for propagation

**Updated handlers:**
- `ServeBanner` (GET /b/{id}) -- reads ad params, includes in impression event extra
- `ClickBanner` (GET /b/{id}/click) -- reads ad params, includes in click event extra, propagates to redirect URL
- `HoverBanner` (GET /b/{id}/hover) -- reads ad params, includes in hover event extra
- `ServeDynamic` (GET /b/serve) -- reads ad params, includes in impression event extra, propagates to click URL and hover URL

**loader.js template update:**
- Reads `data-*` attributes for all 9 ad network params from the `<script>` tag
- Converts kebab-case data attributes to snake_case URL params (e.g., `data-ref-domain` -> `ref_domain`)
- Appends to the iframe src URL

### Frontend (`web/src/components/AdLandingTracker.tsx`)

- Reads all 9 ad network params from URL query string on landing page
- Stores as `ad_params` JSON in sessionStorage
- Params persist for the entire session alongside `ad_source` and `ad_click_id`

### Analytics (`web/src/lib/analytics.ts`)

- `pushEvent()` reads `ad_params` from sessionStorage
- Merges params into events' `extra` JSON field alongside `click_id`
- All subsequent events (social_click, content_click, profile_thumb_click, etc.) automatically include ad network params

### Admin Embed Code (`web/src/app/admin/promo/page.tsx`)

- `adNetworkMacros` object maps source names to their macro placeholders
- For "traforama" source: `%ID%`, `%REFDOMAIN%`, `%ORIGINALREF%`, `%SPOTID%`, `%NODEID%`, `%AUCTIONPRICE%`, `%CPVPRICE%`, `%CPC%`, `%CAMPAIGNID%`, `%CREATIVEID%`
- When a source is selected in the embed code generator, macros are auto-added to both:
  - `<script>` tag as `data-*` attributes
  - iframe URL as query parameters

## Data Flow

```
Ad Network serves banner:
  /b/serve?src=traforama&click_id=%ID%&ref_domain=%REFDOMAIN%&spot_id=%SPOTID%...
    |
    v
Go API: banner_impression event (extra: {"banner_id":42,"ref_domain":"example.com","spot_id":"123",...})
    |
    v
User clicks banner:
  /b/{id}/click?src=traforama&click_id=abc&ref_domain=example.com&spot_id=123...
    |
    v
Go API: banner_click event (extra: same params) + redirect to:
  /model/{slug}?src=traforama&click_id=abc&ref_domain=example.com&spot_id=123...
    |
    v
AdLandingTracker: sessionStorage.setItem("ad_params", JSON.stringify({ref_domain, spot_id,...}))
    |
    v
User browses site, all events enriched with ad_params from sessionStorage
    |
    v
User clicks OnlyFans link:
  social_click event (extra: {"click_id":"abc","ref_domain":"example.com","spot_id":"123",...})
    |
    v
S2S postback to ad network
```

## Files Modified

| File | Changes |
|------|---------|
| `api/internal/handler/banner.go` | Added readAdNetworkParams(), expanded bannerExtra(), added appendAdNetworkParams(), updated ServeBanner/ClickBanner/HoverBanner/ServeDynamic, updated loaderJS template |
| `api/internal/handler/banner_test.go` | Updated TestBannerExtra for new signature (3rd param: adParams map) |
| `web/src/components/AdLandingTracker.tsx` | Reads ad network params from URL, stores as ad_params JSON in sessionStorage |
| `web/src/lib/analytics.ts` | Merges ad_params from sessionStorage into events' extra JSON |
| `web/src/app/admin/promo/page.tsx` | Embed code includes all macros with data-* attributes + iframe URL params when source selected |

## Testing

- `TestBannerExtra` in `banner_test.go` -- updated to pass `nil` as 3rd param (backward compat)
- Manual testing: verify embed code with "traforama" source includes all macro placeholders
- Manual testing: verify params flow through serve -> click -> landing -> sessionStorage -> events
