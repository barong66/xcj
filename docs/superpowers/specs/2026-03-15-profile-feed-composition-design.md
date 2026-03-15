# Profile Feed Composition Design

**Goal:** Replace scattered, hardcoded profile page logic with a configurable, extensible Feed Rule Pipeline — so anyone can open one file, read the composition rules, and change them without touching page or component code.

**Context:** Currently the profile page logic is split across `ModelPage.tsx` (server fetches), `ProfileContent.tsx` (client reorder), and `SimilarModels.tsx` (separate section). Rules are hardcoded, not readable at a glance, and not configurable per site.

---

## Core Concept: Feed Rule Pipeline

A profile feed is a flat, ordered sequence of `FeedRule` objects. Each rule declares **what to fetch**, **how many**, **in what order**, and **which filters to apply**. The result is a unified list of thumbnails rendered top-to-bottom.

```ts
// templates/default/feed-config.ts  ← open this file to see the full composition
export const profileFeedRules: FeedRule[] = [
  { source: "current_model", sort: "trigger_first", count: 1 },
  { source: "current_model", sort: "recent",        count: 5 },
  { source: "similar_category", sort: "ctr",        count: 9 },
]
```

Want a different composition? Change this array. No other files need to change.

---

## Data Structures

### FeedRule

```ts
interface FeedRule {
  source:  FeedSource
  sort:    FeedSort
  count:   number
  filters?: FeedFilter[]
}
```

### FeedSource — where content comes from

| Value | Description |
|-------|-------------|
| `current_model` | Videos from the model being viewed |
| `similar_category` | Videos from other models in the same category |
| `same_country` | Videos from models in the same country |
| `trending` | Popular videos across the whole site |

New sources added here without changing existing rules.

### FeedSort — how to order results

| Value | Description | Data source |
|-------|-------------|-------------|
| `trigger_first` | The clicked video (special: always position 0) | URL `?v=` param |
| `recent` | Newest published first | `published_at DESC` |
| `popular` | Most views first | `view_count DESC` |
| `ctr` | Highest click-through rate | ClickHouse: clicks/impressions |
| `random_popular` | Random sample from top 100 | mixed |

New sorts added here. Existing rules using other sorts are unaffected.

### FeedFilter — narrow the selection

```ts
type FeedFilter =
  | { type: "account_type"; value: "free" | "paid" }
  | { type: "country";      value: string[] }
  | { type: "category";     value: string[] }
  // future: { type: "language"; value: string[] }
  // future: { type: "min_views"; value: number }
```

New filter types added here. Existing rules without that filter are unaffected.

Example with filters:
```ts
{ source: "similar_category", sort: "ctr", count: 6,
  filters: [{ type: "account_type", value: "free" }] }
```

---

## Architecture: Three Modules

### 1. `templates/default/feed-config.ts` — the composition config

Owned by the template. Human-readable. This is the single place to look to understand what a profile page shows.

Default rules for the `default` template:
```ts
export const profileFeedRules: FeedRule[] = [
  { source: "current_model",    sort: "trigger_first", count: 1 },
  { source: "current_model",    sort: "recent",        count: 5 },
  { source: "similar_category", sort: "ctr",           count: 9 },
]
```

Per-site overrides live in `site_config` (DB, edited via Admin UI). Example override:
```json
{ "profile_feed": [
    { "source": "current_model",    "sort": "trigger_first", "count": 1 },
    { "source": "current_model",    "sort": "popular",       "count": 3 },
    { "source": "similar_category", "sort": "ctr",           "count": 6 }
  ]
}
```

### 2. `web/src/lib/profile-feed.ts` — ProfileFeedBuilder (server-side)

Single function that takes an account + trigger video ID + rules, executes all fetches in parallel, and returns a flat ordered list:

```ts
export async function buildProfileFeed(
  account: Account,
  triggerVideoId: string | null,
  rules: FeedRule[]
): Promise<FeedItem[]>
```

**FeedItem:**
```ts
interface FeedItem {
  video: Video
  // Which rule produced this item. Used for analytics (e.g., "did user click
  // a similar_category item?") and for debugging feed composition.
  // Value equals the rule's `source` field: "current_model" | "similar_category" | etc.
  ruleSource: FeedSource
}
```

Rules are executed in order. For each rule:
- `current_model` + `trigger_first` → find video with `id === triggerVideoId` in `account.videos`. If not found, rule produces 0 items (silently skipped — video may be beyond first 24).
- `current_model` + any other sort → slice from already-loaded `account.videos` (no extra API call). Videos already matched by `trigger_first` are excluded to avoid duplicates.
- `similar_category` → calls `SimilarityStrategy.fetch(account, count, sort, filters)`. Strategy receives the full account object so it can read `account.videos[0].categories[0]` and `account.id` for exclusion.
- Other sources → respective API calls (future).

All API calls (non-`current_model`) fire in parallel via `Promise.all` before assembly.

**Deduplication:** A video already selected by an earlier rule is not selected again by a later rule. Deduplication is by `video.id`.

### 3. `web/src/lib/similarity/` — SimilarityStrategy (pluggable)

The `similar_category` source is handled by a strategy. The strategy receives the full account so it can use any account field (categories, country, tags) to find similar content:

```ts
interface SimilarityStrategy {
  // account: full account object (use .videos[0].categories, .country_id, etc.)
  // count: how many videos to return
  // sort: how to order results (strategy maps this to API params)
  // filters: additional narrowing (account_type, country, etc.)
  fetch(account: Account, count: number, sort: FeedSort, filters: FeedFilter[]): Promise<Video[]>
}
```

**v1 implementation:** `SameCategoryStrategy` — fetches videos from `account.videos[0].categories[0]`, excluding current account. Exactly what exists today, just properly isolated.

**Future implementations:** swap in without changing `ProfileFeedBuilder`:
- `SameCategoryAndCountryStrategy`
- `LLMStrategy` (calls an AI service)
- `ManualCurationStrategy` (reads from DB)

Active strategy is set in `feed-config.ts`:
```ts
export const similarityStrategy: SimilarityStrategy = new SameCategoryStrategy()
```

---

## Admin UI Configuration

In `/admin/websites/{id}` → Display Settings, add a "Profile Feed" section with three simple inputs:

- **Model videos count** (default: 5) — number input
- **Similar videos count** (default: 9) — number input
- **Similar sort** — dropdown: `popular` / `recent` / `random_popular` (`ctr` added when ClickHouse sort is implemented)

On save, these write to `site_config` as flat keys: `profile_model_count`, `profile_similar_count`, `profile_similar_sort`.

`ProfileFeedBuilder` reads the template's `profileFeedRules` as the base, then patches the matching rules with site overrides:
- Override `profile_model_count` → patches `count` on the `current_model` (non-trigger) rule
- Override `profile_similar_count` + `profile_similar_sort` → patches `similar_category` rule

This keeps the Admin UI simple (3 fields) while allowing full JSON override of `profileFeedRules` in `site_config` directly for power users.

---

## Migration from Current Code

Current scattered logic → new modules:

| Current | New |
|---------|-----|
| `ModelPage.tsx` lines 85-101 (similar fetch) | `ProfileFeedBuilder` |
| `ProfileContent.tsx` lines 25-36 (reorder) | `FeedRule: trigger_first` |
| `templates/default/SimilarModels.tsx` (separate bottom section) | merged into unified feed, file deleted |

`ProfileContent.tsx` removes `?v=` reorder logic — handled by builder.

`templates/default/SimilarModels.tsx` is **deleted** — similar videos are now just items in the same feed grid, not a separate section. `SimilarModels` is also removed from `SiteTemplate` interface and `default/index.ts`.

`SimilarModels` is NOT part of `app/model/[slug]/` (it was always only in the template).

---

## How to Extend

**Add a new sort option (e.g., `by_likes`):**
1. Add `"by_likes"` to `FeedSort` type in `_shared/feed-types.ts`
2. Handle it in `ProfileFeedBuilder` (add API param or ClickHouse query)
3. Use in any rule: `{ sort: "by_likes", ... }`

**Add a new source (e.g., `same_country`):**
1. Add `"same_country"` to `FeedSource`
2. Handle it in `ProfileFeedBuilder` (new API call)
3. Use in any rule: `{ source: "same_country", ... }`

**Add a new filter (e.g., `min_views`):**
1. Add `{ type: "min_views"; value: number }` to `FeedFilter` union
2. Handle it in the relevant source fetcher
3. Use in any rule: `filters: [{ type: "min_views", value: 1000 }]`

**Add a new similarity strategy:**
1. Create `web/src/lib/similarity/MyStrategy.ts` implementing `SimilarityStrategy`
2. Switch in `feed-config.ts`: `export const similarityStrategy = new MyStrategy()`

**Add a new template with different composition:**
1. Create `templates/my-template/feed-config.ts` with different rules
2. That's it — `ProfileFeedBuilder` is shared, only config changes

---

## Files to Create / Modify

| File | Action | Description |
|------|--------|-------------|
| `web/src/lib/feed-types.ts` | Create | `FeedRule`, `FeedSource`, `FeedSort`, `FeedFilter`, `FeedItem` types |
| `web/src/lib/profile-feed.ts` | Create | `ProfileFeedBuilder` server function |
| `web/src/lib/similarity/same-category.ts` | Create | `SameCategoryStrategy` (v1) |
| `web/src/templates/default/feed-config.ts` | Create | Default rules + active strategy |
| `web/src/templates/default/pages/ModelPage.tsx` | Modify | Use `buildProfileFeed()` instead of inline fetches |
| `web/src/app/model/[slug]/ProfileContent.tsx` | Modify | Remove `?v=` reorder (now in builder) |
| `web/src/templates/default/SimilarModels.tsx` | Remove | Merged into unified feed |
| `web/src/app/admin/websites/[id]/page.tsx` | Modify | Add profile feed settings to Admin UI |

---

## What's in v1 vs Future

### v1 (this spec)
- Sources: `current_model`, `similar_category`
- Sorts: `trigger_first`, `recent`, `popular` (by `view_count` — already in DB), `random_popular`
- Filters: none yet (filter types defined in types but not wired to API calls)
- Similarity: `SameCategoryStrategy` only
- Admin UI: 3 simple override fields

### Future tasks (architecture supports without redesign)
- **CTR sort** — requires ClickHouse aggregation endpoint in Go API
- `same_country` source — new API param
- `trending` source — site-wide aggregation
- New filter types (`account_type`, `country`, `min_views`) — add handler per type
- LLM / external similarity strategy — implement `SimilarityStrategy` interface
- Pagination interleaving (model + similar mixed in scroll) — extend builder
- Home page feed composition — same types, new `homeFeedRules` config
