# Per-Source Event IDs for Postback URLs

> Status: DONE
> Module: api/internal/store/admin_store.go, api/internal/handler/admin.go, api/internal/handler/event.go, web/src/app/admin/accounts/[id]/page.tsx
> Created: 2026-03-08

---

## Overview

Per-model-per-source event ID configuration for S2S postback URLs. Different ad networks number their conversion events differently (1-9), so `event_id` needs to be configured separately for each combination of (account, ad_source, event_type).

Previously, event_id was stored per-model on the `account_conversion_prices` table. This was incorrect because:
- CPA price is the same for a model regardless of which ad network sends the traffic
- Event ID varies per ad network (e.g., ExoClick may use event_id=3 for social_click, while TrafficStars uses event_id=1)

Now CPA price remains per-model (in `account_conversion_prices`), and event_id is per-model-per-source (in the new `account_source_event_ids` table).

## How It Works

1. Admin configures event_id for each active ad source on the account's Promo tab (section "Event IDs per Source")
2. When a conversion event fires with a source + click_id:
   - System looks up CPA price from `account_conversion_prices` (per account + event_type)
   - System looks up event_id from `account_source_event_ids` (per account + ad_source + event_type)
   - Both values are substituted into the postback URL template: `{cpa}` and `{event_id}`
3. Default event_id is 1 if not configured

## Database Changes

### Migration: `scripts/migrations/015_source_event_ids.sql`

**New table: `account_source_event_ids`**
```sql
CREATE TABLE account_source_event_ids (
    id           SERIAL PRIMARY KEY,
    account_id   INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    ad_source_id INT NOT NULL REFERENCES ad_sources(id) ON DELETE CASCADE,
    event_type   VARCHAR(64) NOT NULL,
    event_id     INT NOT NULL DEFAULT 1,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (account_id, ad_source_id, event_type)
);

CREATE INDEX idx_asei_account_source ON account_source_event_ids(account_id, ad_source_id);
```

**Migration status:** NOT YET APPLIED on server.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/admin/accounts/{id}/source-event-ids | List event_id mappings for account (includes ad_source_name via JOIN) |
| PUT | /api/v1/admin/accounts/{id}/source-event-ids | Upsert event_id (body: {ad_source_id, event_type, event_id}) |

**Allowed event types:** `social_click`, `content_click` (validated server-side via `allowedConversionEvents` map).

**GET response:**
```json
{
  "data": [
    {
      "id": 1,
      "account_id": 42,
      "ad_source_id": 1,
      "ad_source_name": "exoclick",
      "event_type": "social_click",
      "event_id": 3,
      "created_at": "...",
      "updated_at": "..."
    }
  ],
  "status": "ok"
}
```

**PUT request body:**
```json
{
  "ad_source_id": 1,
  "event_type": "social_click",
  "event_id": 3
}
```

## Backend Changes

### `api/internal/store/admin_store.go`
- Removed `EventID` field from `AccountConversionPrice` struct (CPA-only now)
- Renamed `GetConversionPriceAndEventID` to `GetConversionPrice` (returns only CPA price, 0 if not configured)
- New `AccountSourceEventID` struct with fields: ID, AccountID, AdSourceID, AdSourceName, EventType, EventID, CreatedAt, UpdatedAt
- `GetAccountSourceEventIDs(ctx, accountID)` -- returns all event_id mappings with source names (JOIN ad_sources)
- `UpsertAccountSourceEventID(ctx, accountID, adSourceID, eventType, eventID)` -- INSERT ON CONFLICT UPDATE
- `GetEventIDForSource(ctx, accountID, adSourceID, eventType)` -- returns event_id (default 1 if not configured)

### `api/internal/handler/admin.go`
- `GetAccountSourceEventIDs` handler -- GET /api/v1/admin/accounts/{id}/source-event-ids
- `UpsertAccountSourceEventID` handler -- PUT /api/v1/admin/accounts/{id}/source-event-ids, validates event_type, event_id (1-9)

### `api/internal/handler/router.go`
- Added routes: `GET /accounts/{id}/source-event-ids`, `PUT /accounts/{id}/source-event-ids`

### `api/internal/handler/event.go`
- `firePostbackIfConfigured` -- now calls `GetConversionPrice` for CPA (per-model) and `GetEventIDForSource` for event_id (per-model-per-source) separately
- Replaces `{event_id}` placeholder in postback URL template

## Frontend Changes

### `web/src/lib/admin-api.ts`
- `AccountSourceEventID` type definition
- `getAccountSourceEventIDs(accountId)` -- GET API call
- `upsertAccountSourceEventID(accountId, adSourceId, eventType, eventId)` -- PUT API call

### `web/src/app/admin/accounts/[id]/page.tsx`
- "Conversion Prices" section now shows only CPA price per event type (event_id removed from this section)
- New "Event IDs per Source" section below Conversion Prices
- Displays a grid of event_id inputs: rows = active ad sources, columns = event types (social_click, content_click)
- Auto-saves on change

## Postback URL Template

Now supports 4 placeholders:
- `{click_id}` -- click ID from ad network
- `{event}` -- conversion event type (social_click / content_click)
- `{cpa}` -- CPA price for the account + event type (from account_conversion_prices, per-model)
- `{event_id}` -- event ID for the account + ad source + event type (from account_source_event_ids, per-model-per-source)

Example:
```
https://adnetwork.com/postback?click_id={click_id}&event={event}&payout={cpa}&event_id={event_id}
```

## Related Files

- `scripts/migrations/015_source_event_ids.sql` -- database migration
- `api/internal/store/admin_store.go` -- data access layer (AccountSourceEventID CRUD + GetConversionPrice)
- `api/internal/handler/admin.go` -- admin HTTP handlers
- `api/internal/handler/router.go` -- route registration
- `api/internal/handler/event.go` -- postback trigger with CPA + event_id
- `web/src/lib/admin-api.ts` -- frontend API client
- `web/src/app/admin/accounts/[id]/page.tsx` -- account promo tab UI (Event IDs per Source section)
