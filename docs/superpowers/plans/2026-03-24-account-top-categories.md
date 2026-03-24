# Account Top Categories Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `?top_categories=N` query param to the account API endpoint that returns an account's top categories ranked by total view count of its videos — and use that to fix similar-models on profile pages.

**Architecture:** New `GetTopCategoriesByViews` store method + handler query param plumbing on the Go side. Frontend: updated `Account` type, `getAccountBySlug` options param, ModelPage passes `top_categories: 3`, SameCategoryStrategy reads from `account.top_categories` directly — removing the `getVideo()` workaround.

**Tech Stack:** Go 1.25 (pgx/v5), Next.js 14 App Router, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-24-account-top-categories-design.md`
**ClickUp:** https://app.clickup.com/t/869cm8qvx

---

## File Map

| File | Change |
|------|--------|
| `api/internal/model/account.go` | Add `CategorySummary` struct + `TopCategories []CategorySummary` field |
| `api/internal/store/account_store.go` | Add `GetTopCategoriesByViews(ctx, accountID, siteID, limit)` method |
| `api/internal/handler/account.go` | Read `?top_categories=N`, bypass cache, call store |
| `web/src/types/index.ts` | Add `AccountCategory` type + `top_categories?` field on `Account` |
| `web/src/lib/api.ts` | Update `getAccountBySlug` with `options?: { top_categories?: number }` |
| `web/src/templates/default/pages/ModelPage.tsx` | Pass `{ top_categories: 3 }` to `getAccountBySlug` |
| `web/src/lib/similarity/same-category.ts` | Use `account.top_categories?.[0]?.slug`, remove `getVideo` workaround |

---

## Chunk 1: Go — Model + Store + Handler

### Task 1: Add CategorySummary to Go model

**Files:**
- Modify: `api/internal/model/account.go`

- [ ] **Read** `api/internal/model/account.go` to see current Account struct

- [ ] **Add** `CategorySummary` struct and `TopCategories` field to `Account`:

```go
// CategorySummary is a category with its total view count for an account.
type CategorySummary struct {
    ID         int64  `json:"id"`
    Slug       string `json:"slug"`
    Name       string `json:"name"`
    TotalViews int64  `json:"total_views"`
}
```

Add to `Account` struct (after `VideoCount`):
```go
TopCategories []CategorySummary `json:"top_categories,omitempty"`
```

- [ ] **Verify** it compiles:
```bash
cd api && go build ./...
```
Expected: no errors.

- [ ] **Commit:**
```bash
git add api/internal/model/account.go
git commit -m "feat(api): add CategorySummary type and TopCategories field to Account model"
```

---

### Task 2: Add GetTopCategoriesByViews to AccountStore

**Files:**
- Modify: `api/internal/store/account_store.go`

- [ ] **Read** `api/internal/store/account_store.go` to find the end of the file (after existing methods)

- [ ] **Add** the new method at the end of the file:

```go
// GetTopCategoriesByViews returns the top N categories for an account,
// ranked by total view count of the account's active videos on the given site.
func (s *AccountStore) GetTopCategoriesByViews(
    ctx context.Context,
    accountID, siteID int64,
    limit int,
) ([]model.CategorySummary, error) {
    if limit <= 0 {
        return nil, nil
    }

    rows, err := s.pool.Query(ctx, `
        SELECT c.id, c.slug, c.name, COALESCE(SUM(v.view_count), 0) AS total_views
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
    `, accountID, siteID, limit)
    if err != nil {
        return nil, fmt.Errorf("account_store: get top categories: %w", err)
    }
    defer rows.Close()

    var cats []model.CategorySummary
    for rows.Next() {
        var c model.CategorySummary
        if err := rows.Scan(&c.ID, &c.Slug, &c.Name, &c.TotalViews); err != nil {
            return nil, fmt.Errorf("account_store: scan category: %w", err)
        }
        cats = append(cats, c)
    }
    if err := rows.Err(); err != nil {
        return nil, fmt.Errorf("account_store: top categories rows: %w", err)
    }

    return cats, nil
}
```

- [ ] **Verify** it compiles:
```bash
cd api && go build ./...
```
Expected: no errors.

- [ ] **Commit:**
```bash
git add api/internal/store/account_store.go
git commit -m "feat(api): add GetTopCategoriesByViews to AccountStore"
```

---

### Task 3: Update account handler to read ?top_categories=N

**Files:**
- Modify: `api/internal/handler/account.go`

**Key decision:** When `top_categories > 0`, skip the Redis cache (cache key doesn't include `top_categories`, and top_categories data changes with video uploads). The SSR page is cached by Next.js anyway.

- [ ] **Read** `api/internal/handler/account.go` fully — focus on `GetBySlug` method (lines ~134-180)

- [ ] **Identify** the two cache blocks in `GetBySlug`:
  ```go
  // Cache read (before store call):
  if page == 1 {
      cacheKey := cache.AccountSlugKey(slug, perPage)
      var cached accountResponse
      if h.cache.GetJSON(r.Context(), cacheKey, &cached) {
          writeJSON(w, http.StatusOK, cached)
          return
      }
  }
  // ...
  // Cache write (after store call):
  if page == 1 {
      cacheKey := cache.AccountSlugKey(slug, perPage)
      h.cache.SetDetail(r.Context(), cacheKey, resp)
  }
  ```

- [ ] **Add** `top_categories` param parsing and top_categories fetch. Modify `GetBySlug` to:

1. Read the param (add right after `perPage := intParam(...)` line):
```go
topCatLimit := intParam(r, "top_categories", 0)
```

2. Skip cache when `topCatLimit > 0` — wrap both cache blocks:
```go
if page == 1 && topCatLimit == 0 {
    cacheKey := cache.AccountSlugKey(slug, perPage)
    var cached accountResponse
    if h.cache.GetJSON(r.Context(), cacheKey, &cached) {
        writeJSON(w, http.StatusOK, cached)
        return
    }
}
```
And the write block:
```go
if page == 1 && topCatLimit == 0 {
    cacheKey := cache.AccountSlugKey(slug, perPage)
    h.cache.SetDetail(r.Context(), cacheKey, resp)
}
```

3. Add top_categories fetch after `account` is returned from store, before `resp := buildAccountResponse(...)`:
```go
if topCatLimit > 0 {
    cats, err := h.accounts.GetTopCategoriesByViews(r.Context(), account.ID, site.ID, topCatLimit)
    if err != nil {
        slog.Warn("handler: get top categories", "error", err, "account_id", account.ID)
        // Non-fatal — continue without top_categories
    } else {
        account.TopCategories = cats
    }
}
```

- [ ] **Verify** it compiles:
```bash
cd api && go build ./...
```

- [ ] **Run tests:**
```bash
cd api && go test ./...
```
Expected: all pass (no account handler tests exist yet, so just confirms no compile errors break existing tests).

- [ ] **Commit:**
```bash
git add api/internal/handler/account.go
git commit -m "feat(api): add ?top_categories=N param to account endpoint, bypass cache"
```

---

## Chunk 2: Frontend — Types + API + ModelPage + SameCategoryStrategy

### Task 4: Add AccountCategory type to frontend

**Files:**
- Modify: `web/src/types/index.ts`

- [ ] **Read** `web/src/types/index.ts` — find the `Account` interface

- [ ] **Add** `AccountCategory` interface (place near `Category`):
```typescript
export interface AccountCategory {
  id: number;
  slug: string;
  name: string;
  total_views: number;
}
```

- [ ] **Add** `top_categories` to `Account` interface (after `video_count`):
```typescript
top_categories?: AccountCategory[];
```

- [ ] **Verify TypeScript:**
```bash
cd web && npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors.

- [ ] **Commit:**
```bash
git add web/src/types/index.ts
git commit -m "feat(web): add AccountCategory type and top_categories field to Account"
```

---

### Task 5: Update getAccountBySlug to forward top_categories

**Files:**
- Modify: `web/src/lib/api.ts`

- [ ] **Read** `web/src/lib/api.ts` lines 85-105 — current `getAccountBySlug` signature

- [ ] **Update** the function signature and body:

```typescript
export async function getAccountBySlug(
  slug: string,
  page: number = 1,
  per_page: number = 24,
  options?: { top_categories?: number },
): Promise<AccountResponse> {
  const searchParams = new URLSearchParams();
  searchParams.set("page", String(page));
  searchParams.set("per_page", String(per_page));
  if (options?.top_categories) {
    searchParams.set("top_categories", String(options.top_categories));
  }

  return fetchAPI<AccountResponse>(
    `/api/v1/accounts/slug/${encodeURIComponent(slug)}?${searchParams.toString()}`,
  );
}
```

- [ ] **Verify TypeScript:**
```bash
cd web && npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors.

- [ ] **Commit:**
```bash
git add web/src/lib/api.ts
git commit -m "feat(web): update getAccountBySlug to accept top_categories option"
```

---

### Task 6: Pass top_categories in ModelPage

**Files:**
- Modify: `web/src/templates/default/pages/ModelPage.tsx`

- [ ] **Read** `web/src/templates/default/pages/ModelPage.tsx` — find the `getAccountBySlug` call

- [ ] **Update** the call to pass `{ top_categories: 3 }`:

The current call looks like:
```typescript
const account = await getAccountBySlug(slug, 1, perPage);
```

Change to:
```typescript
const account = await getAccountBySlug(slug, 1, perPage, { top_categories: 3 });
```

- [ ] **Verify TypeScript:**
```bash
cd web && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Commit:**
```bash
git add web/src/templates/default/pages/ModelPage.tsx
git commit -m "feat(web): pass top_categories: 3 to getAccountBySlug in ModelPage"
```

---

### Task 7: Simplify SameCategoryStrategy — remove getVideo workaround

**Files:**
- Modify: `web/src/lib/similarity/same-category.ts`

- [ ] **Read** `web/src/lib/similarity/same-category.ts` — current file has `getVideo` workaround (lines 16-29)

- [ ] **Replace** the entire top-category resolution block:

**Current (lines 1-29):**
```typescript
import { getVideos, getVideo } from "@/lib/api";
// ...
    let topCategory = account.videos?.[0]?.categories?.[0]?.slug;
    if (!topCategory) {
      const firstId = account.videos?.[0]?.id;
      if (!firstId) return [];
      try {
        const firstVideo = await getVideo(String(firstId));
        topCategory = firstVideo?.categories?.[0]?.slug;
      } catch {
        return [];
      }
    }
    if (!topCategory) return [];
```

**New:**
```typescript
import { getVideos } from "@/lib/api";
// ...
    const topCategory = account.top_categories?.[0]?.slug;
    if (!topCategory) return [];
```

Remove `getVideo` from the import. Remove the entire workaround block.

- [ ] **Verify TypeScript:**
```bash
cd web && npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors. Confirms `account.top_categories` type is correct.

- [ ] **Run build:**
```bash
cd web && npm run build 2>&1 | tail -20
```
Expected: clean build, no errors.

- [ ] **Commit:**
```bash
git add web/src/lib/similarity/same-category.ts
git commit -m "feat(web): simplify SameCategoryStrategy — use account.top_categories, remove getVideo workaround"
```

---

## Final: Deploy and verify

- [ ] **Push:**
```bash
git push origin main
```

- [ ] **Deploy:**
```bash
ssh traforama@37.27.189.122 "cd /opt/traforama/xcj && git pull origin main && docker compose -f deploy/docker/docker-compose.yml --env-file .env up -d --build api web"
```
Expected: both `api` and `web` containers rebuild and start.

- [ ] **Verify similar models appear** on a profile page: https://temptguide.com/model/katssuunn

- [ ] **Run Project Manager agent** — update ClickUp task 869cm8qvx as done, update docs/tasks/account-top-categories.md with DONE status.
