# Per-Account Conversion Prices (CPA) for Postback URLs

> Status: DONE
> Module: api/internal/store/admin_store.go, api/internal/handler/admin.go, api/internal/handler/event.go, api/internal/cron/postback_retry.go, web/src/app/admin/accounts/[id]/page.tsx
> Created: 2026-03-08

---

## Overview

Per-model (per-account) conversion pricing that gets injected into S2S postback URLs via the `{cpa}` placeholder. Enables integration with ad networks like pa6ka that require a CPA value in their postback.

Previously postback URLs only supported `{click_id}` and `{event}` placeholders. Now a third placeholder `{cpa}` is available, which is resolved per-account per-event-type from the `account_conversion_prices` table.

## How It Works

1. Admin sets CPA price per event type (social_click, content_click) for each account on the account's Promo tab
2. When a conversion event fires (social_click or content_click) with a source + click_id:
   - System looks up the ad source postback URL template
   - System looks up the CPA price from `account_conversion_prices` for the account + event_type
   - All three placeholders are replaced: `{click_id}`, `{event}`, `{cpa}`
   - CPA amount is stored on the `conversion_postbacks` record for audit and retry consistency
3. On retry (cron job), the stored `cpa_amount` from the postback record is used (not re-fetched)

## Database Changes

### Migration: `scripts/migrations/013_account_conversion_prices.sql`

**New table: `account_conversion_prices`**
```sql
CREATE TABLE account_conversion_prices (
    id         SERIAL PRIMARY KEY,
    account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    event_type VARCHAR(64) NOT NULL,
    price      NUMERIC(10,4) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (account_id, event_type)
);

CREATE INDEX idx_acp_account_id ON account_conversion_prices(account_id);
```

**New column on `conversion_postbacks`:**
```sql
ALTER TABLE conversion_postbacks ADD COLUMN cpa_amount NUMERIC(10,4);
```

**Migration status:** NOT YET APPLIED on server.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/admin/accounts/{id}/conversion-prices | List CPA prices for account (returns array of {event_type, price}) |
| PUT | /api/v1/admin/accounts/{id}/conversion-prices | Upsert CPA price (body: {event_type, price}) |

**Allowed event types:** `social_click`, `content_click` (validated server-side via `allowedConversionEvents` map).

## Backend Changes

### `api/internal/store/admin_store.go`
- `AccountConversionPrice` struct — model for CPA prices
- `GetAccountConversionPrices(ctx, accountID)` — list all prices for account
- `UpsertAccountConversionPrice(ctx, accountID, eventType, price)` — INSERT ON CONFLICT UPDATE
- `GetConversionPrice(ctx, accountID, eventType)` — get single price (returns 0 if not found)
- `ConversionPostback` struct updated with `CpaAmount` field
- `CreateConversionPostback` — now accepts and stores `cpa_amount`
- `ListPendingPostbacks` / `ListRecentPostbacks` — now return `cpa_amount`

### `api/internal/handler/admin.go`
- `GetAccountConversionPrices` handler — validates account exists, returns prices
- `UpsertAccountConversionPrice` handler — validates event_type against allowedConversionEvents, upserts price

### `api/internal/handler/router.go`
- Added routes: `GET /accounts/{id}/conversion-prices`, `PUT /accounts/{id}/conversion-prices`

### `api/internal/handler/event.go`
- `firePostbackIfConfigured` — added `{cpa}` placeholder replacement. Looks up CPA via `store.GetConversionPrice(accountID, eventType)` and replaces `{cpa}` in URL template

### `api/internal/cron/postback_retry.go`
- Retry logic uses stored `pb.CpaAmount` for `{cpa}` replacement instead of re-fetching from DB

## Frontend Changes

### `web/src/lib/admin-api.ts`
- `AccountConversionPrice` type definition
- `getAccountConversionPrices(accountId)` — API call
- `upsertAccountConversionPrice(accountId, eventType, price)` — API call

### `web/src/app/admin/accounts/[id]/page.tsx`
- New "Conversion Prices" section on the Promo tab
- Per-event-type price inputs (social_click, content_click)
- Auto-saves on blur/change

### `web/src/app/admin/promo/page.tsx`
- Updated conversion tracking info to mention `{cpa}` placeholder in postback URL templates

## Postback URL Template

Now supports 3 placeholders:
- `{click_id}` — click ID from ad network
- `{event}` — conversion event type (social_click / content_click)
- `{cpa}` — CPA price for the account + event type (from account_conversion_prices)

Example:
```
https://adnetwork.com/postback?click_id={click_id}&event={event}&payout={cpa}
```

## Related Files

- `scripts/migrations/013_account_conversion_prices.sql` — database migration
- `api/internal/store/admin_store.go` — data access layer
- `api/internal/handler/admin.go` — admin HTTP handlers
- `api/internal/handler/router.go` — route registration
- `api/internal/handler/event.go` — postback trigger with CPA
- `api/internal/cron/postback_retry.go` — retry with stored CPA
- `web/src/lib/admin-api.ts` — frontend API client
- `web/src/app/admin/accounts/[id]/page.tsx` — account promo tab UI
- `web/src/app/admin/promo/page.tsx` — promo settings info
