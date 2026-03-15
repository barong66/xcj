# Profile Feed Composition System

> Status: **Design complete. V1 implementation NOT started.** (2026-03-15)
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
  ProfileFeedBuilder.build(account)
     |
     |-- rule: current_model -----> fetch account's own videos
     |                                  apply sort (recent / popular / ...)
     |                                  apply filters
     |
     |-- rule: similar_category --> SimilarityStrategy.findSimilar(account)
     |                                  v1: SameCategoryStrategy
     |                                  future: LLMStrategy, ExternalAPIStrategy
     |                                  apply sort (trigger_first / ...)
     |                                  apply filters
     |
     v
  FeedSection[]  (title + items)
        |
        v
  Rendered profile page
```

**Config hierarchy:**

```
feed-config.ts (template defaults)
       |
       v (merged with)
sites.config JSONB key "feed"
       |
       v (exposed as)
Admin UI: 3 fields on Websites → [site] → Display Settings
  - model_count
  - similar_count
  - similar_sort
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

interface FeedFilter {
  account_type?: 'paid' | 'free' | 'any';
  country?: string;    // ISO code
  category?: string;   // category slug
  min_views?: number;
}

interface FeedRule {
  source: FeedSource;
  sort: FeedSort;
  count: number;
  filters?: FeedFilter;
}
```

---

## Key Modules

### ProfileFeedBuilder (`web/src/lib/profile-feed.ts`)

Server-side class. All feed assembly logic lives here.

```typescript
class ProfileFeedBuilder {
  constructor(
    private rules: FeedRule[],
    private strategy: SimilarityStrategy,
    private siteConfig?: SiteFeedOverride,
  ) {}

  async build(account: Account): Promise<FeedSection[]>
}
```

Algorithm:
1. Merge template `FeedRule[]` defaults with `siteConfig` overrides
2. For each rule: call source fetcher, apply filters, apply sort
3. Return ordered `FeedSection[]`

### SimilarityStrategy (pluggable interface)

```typescript
interface SimilarityStrategy {
  findSimilar(account: Account, count: number): Promise<Account[]>
}
```

**V1 — SameCategoryStrategy** (`web/src/lib/similarity/same-category.ts`):
- Finds the model's top category
- Fetches accounts from the same category (excluding viewed model)
- Orders by `trigger_first` (paid first), then by video count

### Default Config (`web/src/templates/default/feed-config.ts`)

```typescript
export const DEFAULT_FEED_RULES: FeedRule[] = [
  {
    source: 'current_model',
    sort: 'recent',
    count: 20,
  },
  {
    source: 'similar_category',
    sort: 'trigger_first',
    count: 6,
  },
];
```

---

## V1 Files

| File | Action | Notes |
|------|--------|-------|
| `web/src/lib/feed-types.ts` | Create | All types |
| `web/src/lib/profile-feed.ts` | Create | ProfileFeedBuilder |
| `web/src/lib/similarity/same-category.ts` | Create | V1 strategy |
| `web/src/templates/default/feed-config.ts` | Create | Default rules |
| `web/src/templates/default/pages/ModelPage.tsx` | Modify | Use builder |
| `web/src/app/model/[slug]/ProfileContent.tsx` | Modify | Remove reorder logic |
| `web/src/templates/default/SimilarModels.tsx` | Delete | Merged into feed |
| `web/src/app/admin/websites/[id]/page.tsx` | Modify | Add 3 override fields |

---

## Future Tasks (ClickUp subtasks)

| Task | Priority | ClickUp |
|------|----------|---------|
| V1 implementation (ProfileFeedBuilder + SameCategoryStrategy + feed-config) | HIGH | https://app.clickup.com/t/869cg0gvj |
| Admin UI: 3 feed override fields (model_count, similar_count, similar_sort) | NORMAL | https://app.clickup.com/t/869cg0h03 |
| CTR sort (ClickHouse aggregation endpoint in Go API) | NORMAL | https://app.clickup.com/t/869cg0h33 |
| same_country and trending sources | LOW | https://app.clickup.com/t/869cg0h4k |
| FeedFilter wiring (account_type, country, min_views) | LOW | https://app.clickup.com/t/869cg0h5u |
| Home page feed composition (same FeedRule pattern) | LOW | https://app.clickup.com/t/869cg0h6f |

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
