# Account Top Categories — Design Spec

**Date:** 2026-03-24
**Status:** Approved, pending implementation

## Problem

`AccountStore.GetBySlug` returns account videos without category data — the account store SQL never JOINs with `video_categories`. As a result:

- `account.videos[0].categories` is always empty
- `SameCategoryStrategy` cannot determine the account's content niche
- Similar models section shows nothing on profile pages

Current workaround: `SameCategoryStrategy` calls `getVideo(firstVideoId)` as a fallback — an extra HTTP round-trip on every SSR profile render, and it uses categories from one video (not the account's overall profile).

## Goal

Add `top_categories` to the account API response: a ranked list of categories for the account, ordered by total view count of the account's videos in each category. Configurable limit via query param.

## Design

### Approach: Query param `?top_categories=N` on existing account endpoint

Zero overhead by default. Only computed when explicitly requested. All data returned in a single HTTP request.

---

## Go: Model

**File:** `api/internal/model/account.go`

Add new type and field:

```go
type CategorySummary struct {
    ID         int64  `json:"id"`
    Slug       string `json:"slug"`
    Name       string `json:"name"`
    TotalViews int64  `json:"total_views"`
}

// In Account struct:
TopCategories []CategorySummary `json:"top_categories,omitempty"`
```

---

## Go: Account Store

**File:** `api/internal/store/account_store.go`

New method:

```go
func (s *AccountStore) GetTopCategoriesByViews(
    ctx context.Context,
    accountID, siteID int64,
    limit int,
) ([]CategorySummary, error)
```

SQL:

```sql
SELECT c.id, c.slug, c.name, SUM(v.view_count) AS total_views
FROM categories c
JOIN video_categories vc ON vc.category_id = c.id
JOIN videos v ON v.id = vc.video_id
JOIN site_videos sv ON sv.video_id = v.id
WHERE v.account_id = $1
  AND sv.site_id   = $2
  AND v.is_active  = true
GROUP BY c.id, c.slug, c.name
ORDER BY total_views DESC
LIMIT $3
```

Ranks categories by total views across all of the account's active videos on the given site. Uses `site_videos` to scope to the current site.

---

## Go: Account Handler

**File:** `api/internal/handler/account.go`

Read optional query param and call store method after fetching account:

```go
topCatLimit := 0
if s := r.URL.Query().Get("top_categories"); s != "" {
    if n, err := strconv.Atoi(s); err == nil && n > 0 {
        topCatLimit = n
    }
}

// After account is fetched:
if topCatLimit > 0 && account != nil {
    account.TopCategories, _ = h.accounts.GetTopCategoriesByViews(
        r.Context(), account.ID, site.ID, topCatLimit,
    )
}
```

Errors are silently ignored — `top_categories` is supplementary data, its absence should not break the page.

---

## Frontend: Types

**File:** `web/src/types/index.ts`

```typescript
export interface AccountCategory {
  id: number;
  slug: string;
  name: string;
  total_views: number;
}

// In Account interface:
top_categories?: AccountCategory[];
```

---

## Frontend: API Client

**File:** `web/src/lib/api.ts`

Update `getAccountBySlug` signature:

```typescript
export async function getAccountBySlug(
  slug: string,
  page = 1,
  per_page = 24,
  options?: { top_categories?: number }
): Promise<Account | null>
```

Adds `?top_categories=N` to query string when `options.top_categories` is provided.

---

## Frontend: ModelPage

**File:** `web/src/templates/default/pages/ModelPage.tsx`

Pass `top_categories: 3` when fetching the account:

```typescript
const account = await getAccountBySlug(slug, 1, perPage, { top_categories: 3 });
```

3 categories is enough for similar-models (uses top 1) with room for future use (SEO meta, profile tags).

---

## Frontend: SameCategoryStrategy

**File:** `web/src/lib/similarity/same-category.ts`

Remove the `getVideo()` workaround. Use `account.top_categories` directly:

```typescript
const topCategory = account.top_categories?.[0]?.slug;
if (!topCategory) return [];
```

Remove `getVideo` import — no longer needed.

---

## Data Flow (after implementation)

```
ModelPage (SSR)
  └─ getAccountBySlug(slug, 1, 24, { top_categories: 3 })
       └─ GET /api/v1/accounts/{slug}?top_categories=3
            ├─ AccountStore.GetBySlug()       → account + videos
            └─ AccountStore.GetTopCategoriesByViews() → top 3 categories by views
                                                         (1 extra SQL, batched)
  └─ buildProfileFeed(account, triggerVideoId, rules, strategy)
       └─ SameCategoryStrategy.fetch()
            └─ account.top_categories[0].slug  ← no extra HTTP call
```

---

## Implementation Tasks

| # | Task | Files |
|---|------|-------|
| 1 | Add `CategorySummary` type + `TopCategories` field to Account model | `api/internal/model/account.go` |
| 2 | Add `GetTopCategoriesByViews` method to AccountStore | `api/internal/store/account_store.go` |
| 3 | Update account handler to read `?top_categories=N` and call store | `api/internal/handler/account.go` |
| 4 | Add `AccountCategory` type + `top_categories` field to frontend Account | `web/src/types/index.ts` |
| 5 | Update `getAccountBySlug` to accept and forward `top_categories` option | `web/src/lib/api.ts` |
| 6 | Pass `{ top_categories: 3 }` in ModelPage | `web/src/templates/default/pages/ModelPage.tsx` |
| 7 | Simplify `SameCategoryStrategy` — use `account.top_categories`, remove `getVideo` workaround | `web/src/lib/similarity/same-category.ts` |

---

## Out of Scope (v1)

- Caching of top_categories (can be added later if slow)
- Exposing `total_views` in the UI (stored for future use)
- Multi-category similarity (using top 2-3 categories for broader matching)
- Admin UI for per-site top_categories limit override
