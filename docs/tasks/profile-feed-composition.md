# Profile Feed Composition System

> Status: **Implemented and deployed.** (2026-03-15)
> ClickUp: https://app.clickup.com/t/869cg0gug

## Summary

A configurable, extensible **Feed Rule Pipeline** for the model profile page (`/model/[slug]`). Replaces ad-hoc per-component layout decisions with a single declarative config file per template.

**The key insight:** open `web/src/templates/default/feed-config.ts` — see exactly what the profile page shows, in order, with counts. One file of data, zero scattered logic.

---

## Architecture Diagram

```
/model/[slug] page request
        |
        v
  ModelPage.tsx (server component)
        |
        v
  buildProfileFeed(account, rules, strategy, siteConfig)
     |
     |-- applyFeedOverrides(rules, siteConfig)
     |       merges per-site overrides into template defaults
     |
     |-- rule: current_model -----> fetch account's own videos
     |                                  apply sort (recent / trigger_first / ...)
     |                                  apply filters
     |
     |-- rule: similar_category --> strategy.fetch(account, count, sort, filters)
     |                                  v1: SameCategoryStrategy
     |                                  future: LLMStrategy, ExternalAPIStrategy
     |
     v
  FeedItem[]  (flat list, ordered by rule sequence)
        |
        v
  ProfileContent.tsx  (pure presenter — renders FeedItem[])
        |
        v
  Rendered profile page
```

**Config hierarchy:**

```
feed-config.ts (template defaults)
       |
       v (merged with via applyFeedOverrides)
sites.config JSONB (flat keys at root level)
       |
       v (exposed as)
Admin UI: 3 fields on Websites → [site] → Display Settings → Profile Feed
  - profile_model_count
  - profile_similar_count
  - profile_similar_sort
```

---

## Core Types

```typescript
// web/src/lib/feed-types.ts

type FeedSource =
  | 'current_model'    // videos from the viewed model's account
  | 'similar_category' // accounts sharing a category (v1)
  | 'same_country'     // models from same country (future)
  | 'trending';        // trending content (future)

type FeedSort =
  | 'trigger_first'   // paid/promo accounts first
  | 'recent'          // newest first
  | 'popular'         // most views
  | 'ctr'             // highest CTR from ClickHouse (future)
  | 'random_popular'; // weighted random from top-N

// Discriminated union — each filter is one specific constraint
type FeedFilter =
  | { type: 'account_type'; value: 'free' | 'paid' }
  | { type: 'country';      value: string[] }
  | { type: 'category';     value: string[] };

interface FeedRule {
  source: FeedSource;
  sort: FeedSort;
  count: number;
  filters?: FeedFilter[];  // array of constraints
}
```

---

## Key Modules

### buildProfileFeed / applyFeedOverrides (`web/src/lib/profile-feed.ts`)

Server-side module. All feed assembly logic lives here.

```typescript
async function buildProfileFeed(
  account: Account,
  rules: FeedRule[],
  strategy: SimilarityStrategy,
  siteConfig?: SiteFeedOverride
): Promise<FeedItem[]>

function applyFeedOverrides(
  rules: FeedRule[],
  overrides: SiteFeedOverride
): FeedRule[]
```

Algorithm:
1. Call `applyFeedOverrides()` to merge template `FeedRule[]` defaults with `siteConfig` overrides
2. For each rule: call source fetcher (current model or similarity strategy), apply filters, apply sort
3. Return flat `FeedItem[]` in rule sequence order

### SimilarityStrategy (pluggable interface)

```typescript
interface SimilarityStrategy {
  fetch(
    account: Account,
    count: number,
    sort: FeedSort,
    filters: FeedFilter[]
  ): Promise<Video[]>;
}
```

**V1 — SameCategoryStrategy** (`web/src/lib/similarity/same-category.ts`):
- Finds the model's top category
- Fetches videos from accounts in the same category (excluding viewed model)
- Respects the `sort` param passed by the calling `FeedRule`

### Default Config (`web/src/templates/default/feed-config.ts`)

```typescript
export const profileFeedRules: FeedRule[] = [
  { source: "current_model",    sort: "trigger_first", count: 1 },
  { source: "current_model",    sort: "recent",        count: 5 },
  { source: "similar_category", sort: "popular",       count: 9 },
];

export const similarityStrategy = new SameCategoryStrategy();
```

Rule order: one trigger/promoted video first, five recent from the same model, nine popular from similar models.

---

## Implemented Files

| File | Action | Notes |
|------|--------|-------|
| `web/src/lib/feed-types.ts` | Created | FeedRule, FeedItem, FeedSource, FeedSort, FeedFilter, SimilarityStrategy |
| `web/src/lib/profile-feed.ts` | Created | buildProfileFeed() + applyFeedOverrides() |
| `web/src/lib/similarity/same-category.ts` | Created | SameCategoryStrategy (v1) |
| `web/src/templates/default/feed-config.ts` | Created | profileFeedRules + similarityStrategy instance |
| `web/src/templates/default/pages/ModelPage.tsx` | Modified | Uses buildProfileFeed(); removed SimilarModels usage |
| `web/src/app/model/[slug]/ProfileContent.tsx` | Modified | Pure presenter; removed reorder logic + infinite scroll |
| `web/src/lib/admin-api.ts` | Modified | Added profile_model_count, profile_similar_count, profile_similar_sort to SiteConfig |
| `web/src/app/admin/websites/[id]/page.tsx` | Modified | Added Profile Feed section with 3 editable fields |
| `web/src/templates/_shared/types.ts` | Modified | Removed SimilarModels from SiteTemplate |
| `web/src/templates/default/index.ts` | Modified | Removed SimilarModels export |
| `web/src/templates/default/SimilarModels.tsx` | Deleted | Replaced by feed pipeline |
| `web/src/app/model/[slug]/SimilarModels.tsx` | Deleted | Replaced by feed pipeline |

---

## ClickUp Subtasks

| Task | Priority | Status | ClickUp |
|------|----------|--------|---------|
| V1 implementation (buildProfileFeed + SameCategoryStrategy + feed-config) | HIGH | DONE | https://app.clickup.com/t/869cg0gvj |
| Admin UI: 3 feed override fields (model_count, similar_count, similar_sort) | NORMAL | DONE | https://app.clickup.com/t/869cg0h03 |
| CTR sort (ClickHouse aggregation endpoint in Go API) | NORMAL | TODO | https://app.clickup.com/t/869cg0h33 |
| same_country and trending sources | LOW | TODO | https://app.clickup.com/t/869cg0h4k |
| FeedFilter wiring (account_type, country, min_views) | LOW | TODO | https://app.clickup.com/t/869cg0h5u |
| Home page feed composition (same FeedRule pattern) | LOW | TODO | https://app.clickup.com/t/869cg0h6f |

---

## How to Extend

### Add a new source

1. Add value to `FeedSource` union in `web/src/lib/feed-types.ts`
2. Implement a fetcher function in `web/src/lib/profile-feed.ts`
3. Wire in `ProfileFeedBuilder.build()` switch statement
4. Reference in any `FeedRule[]` config

### Add a new sort

1. Add value to `FeedSort` union
2. Implement in `applySort()` in `profile-feed.ts`

### Add a new filter field

1. Add field to `FeedFilter` interface
2. Implement in `applyFilter()` in `profile-feed.ts`

### Add a new similarity strategy

1. Implement `SimilarityStrategy` interface
2. Register via factory or constructor injection in `ProfileFeedBuilder`
3. Select strategy via site config or template default

### Add a new template with custom feed rules

1. Create `web/src/templates/<name>/feed-config.ts` with custom `FeedRule[]`
2. Pass it to `ProfileFeedBuilder` in the template's `ModelPage.tsx`
3. The site config overrides still apply on top

---

## Design Decisions

- **Declarative, data-only rules** — `FeedRule` has no methods, only data. All logic is in `ProfileFeedBuilder`. Makes rules serializable to JSON (useful for DB storage and Admin UI).
- **Server-side assembly** — `ProfileFeedBuilder` runs in a Next.js Server Component, so there is no client-side fetch waterfall.
- **Pluggable strategy** — `SimilarityStrategy` is an interface, not a concrete class. This makes it easy to swap the similarity algorithm without touching feed composition logic.
- **Config file as source of truth** — `feed-config.ts` is the single place to read to understand the page. No need to trace through multiple components.
- **3 admin fields only** — the Admin UI exposes only the most commonly needed overrides (count + sort). Advanced users can edit `feed-config.ts` for full control.
