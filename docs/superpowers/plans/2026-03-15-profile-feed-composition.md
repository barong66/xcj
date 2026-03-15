# Profile Feed Composition Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace scattered, hardcoded profile page logic with a configurable Feed Rule Pipeline — one config file defines what appears on the profile page, and it's easy to change without touching page code.

**Architecture:** Types + SimilarityStrategy + ProfileFeedBuilder assembled server-side in `ModelPage.tsx`. Template config in `feed-config.ts`. Per-site overrides via 3 Admin UI fields. `SimilarModels` section removed — similar videos flow into the same grid.

**Tech Stack:** Next.js 14 App Router, TypeScript, existing `getVideos()` API call in `web/src/lib/api.ts`.

---

## Codebase orientation

Key files to read before starting each task:
- **Types context:** `web/src/types.ts` — `Account`, `Video`, `SortOption`
- **API calls:** `web/src/lib/api.ts` — `getVideos()` signature
- **Current model page:** `web/src/templates/default/pages/ModelPage.tsx` — what to replace
- **Current client:** `web/src/app/model/[slug]/ProfileContent.tsx` — reorder logic to remove
- **Current similar:** `web/src/templates/default/SimilarModels.tsx` — to be deleted
- **Template types:** `web/src/templates/_shared/types.ts` — `SiteTemplate` interface (SimilarModels to remove)
- **Template index:** `web/src/templates/default/index.ts` — SimilarModels export to remove
- **Admin UI:** `web/src/app/admin/websites/[id]/page.tsx` — where to add 3 feed fields
- **Admin API types:** `web/src/lib/admin-api.ts` — `SiteConfig` interface

---

## Chunk 1: Types, Strategy, Builder

### Task 1: Create `feed-types.ts` — shared types for the feed pipeline

**Files:**
- Create: `web/src/lib/feed-types.ts`

- [ ] **Step 1: Create the file with all types**

```typescript
// web/src/lib/feed-types.ts
import type { Account, Video } from "@/types";

export type FeedSource =
  | "current_model"
  | "similar_category"
  | "same_country"   // future
  | "trending";      // future

export type FeedSort =
  | "trigger_first"
  | "recent"
  | "popular"
  | "ctr"           // future: requires ClickHouse
  | "random_popular";

export type FeedFilter =
  | { type: "account_type"; value: "free" | "paid" }
  | { type: "country"; value: string[] }
  | { type: "category"; value: string[] };
  // future: | { type: "language"; value: string[] }
  // future: | { type: "min_views"; value: number }

export interface FeedRule {
  source: FeedSource;
  sort: FeedSort;
  count: number;
  filters?: FeedFilter[];
}

export interface FeedItem {
  video: Video;
  // Which rule produced this item. Used for analytics / debugging.
  ruleSource: FeedSource;
}

// Pluggable interface for "find similar content".
// Implement this to swap in a new similarity algorithm without
// changing ProfileFeedBuilder.
export interface SimilarityStrategy {
  // account: full Account object — use .videos[0].categories, .id, etc.
  // count: max videos to return
  // sort: how to order (strategy maps to API params)
  // filters: additional constraints (passed through, wired per-filter in v2+)
  fetch(
    account: Account,
    count: number,
    sort: FeedSort,
    filters: FeedFilter[]
  ): Promise<Video[]>;
}
```

- [ ] **Step 2: Verify TypeScript accepts the file**

```bash
cd web && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors related to `feed-types.ts`

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/feed-types.ts
git commit -m "feat(web): add feed-types.ts — FeedRule, FeedSort, FeedSource, SimilarityStrategy"
```

---

### Task 2: Create `same-category.ts` — v1 SimilarityStrategy

This encapsulates the existing "fetch videos from same category" logic that currently lives inline in `ModelPage.tsx` lines 85-101.

**Files:**
- Create: `web/src/lib/similarity/same-category.ts`

- [ ] **Step 1: Create the strategy**

```typescript
// web/src/lib/similarity/same-category.ts
import { getVideos } from "@/lib/api";
import type { Account, Video } from "@/types";
import type { FeedSort, FeedFilter, SimilarityStrategy } from "@/lib/feed-types";

// Finds videos from other models that share the same top category
// as the first video of the current account.
// - Deduplicates by account: shows at most 1 video per other model.
// - For "random_popular": fetches 3x count from API, shuffles, slices.
export class SameCategoryStrategy implements SimilarityStrategy {
  async fetch(
    account: Account,
    count: number,
    sort: FeedSort,
    _filters: FeedFilter[]
  ): Promise<Video[]> {
    const topCategory = account.videos?.[0]?.categories?.[0]?.slug;
    if (!topCategory) return [];

    // "ctr" and "random_popular" are not direct API params — map to "popular".
    // "random_popular" fetches more and shuffles below.
    const apiSort =
      sort === "recent" ? "recent" : "popular";
    const fetchCount =
      sort === "random_popular" ? Math.min(count * 4, 60) : count * 2;

    const result = await getVideos({
      category: topCategory,
      exclude_account_id: account.id,
      per_page: fetchCount,
      sort: apiSort,
    });

    let videos = result.videos || [];

    // Deduplicate: one video per unique account.
    const seen = new Set<number>();
    videos = videos.filter((v) => {
      const aid = v.account?.id;
      if (!aid || seen.has(aid)) return false;
      seen.add(aid);
      return true;
    });

    // Shuffle for random_popular, then take count.
    if (sort === "random_popular") {
      videos = videos.sort(() => Math.random() - 0.5);
    }

    return videos.slice(0, count);
  }
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd web && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/similarity/same-category.ts
git commit -m "feat(web): add SameCategoryStrategy — v1 similarity implementation"
```

---

### Task 3: Create `profile-feed.ts` — ProfileFeedBuilder

The single server-side function that assembles the feed from rules. All data fetching goes through here.

**Files:**
- Create: `web/src/lib/profile-feed.ts`

- [ ] **Step 1: Create the builder**

```typescript
// web/src/lib/profile-feed.ts
// SERVER-SIDE ONLY — uses getVideos() which calls next/headers internally.
import type { Account, Video } from "@/types";
import type {
  FeedRule,
  FeedItem,
  FeedSort,
  SimilarityStrategy,
} from "@/lib/feed-types";

// Assembles the profile page feed from an ordered list of FeedRules.
//
// Rules are applied in order. Each rule selects up to `count` videos
// from its source, deduplicating against all previously selected videos.
//
// External fetches (non-current_model) are fired in parallel before assembly.
//
// Usage:
//   const items = await buildProfileFeed(account, "536", rules, strategy);
//   const videos = items.map(item => item.video);
export async function buildProfileFeed(
  account: Account,
  triggerVideoId: string | null,
  rules: FeedRule[],
  similarityStrategy: SimilarityStrategy
): Promise<FeedItem[]> {
  const usedIds = new Set<number>();
  const result: FeedItem[] = [];

  // Fire all external (non-current_model) fetches in parallel.
  const externalRules = rules.filter((r) => r.source !== "current_model");
  const externalVideos = await Promise.all(
    externalRules.map((rule) =>
      fetchExternal(rule, account, similarityStrategy)
    )
  );
  const externalMap = new Map<FeedRule, Video[]>();
  externalRules.forEach((rule, i) => externalMap.set(rule, externalVideos[i]));

  // Assemble in rule order.
  for (const rule of rules) {
    let candidates: Video[];

    if (rule.source === "current_model") {
      if (rule.sort === "trigger_first") {
        // The video the user clicked. If not in first page, produces 0 items.
        const found = (account.videos || []).find(
          (v) => String(v.id) === triggerVideoId
        );
        candidates = found ? [found] : [];
      } else {
        // Sort account's videos, excluding already-used ones.
        const available = (account.videos || []).filter(
          (v) => !usedIds.has(v.id)
        );
        candidates = sortVideos(available, rule.sort);
      }
    } else {
      candidates = (externalMap.get(rule) || []).filter(
        (v) => !usedIds.has(v.id)
      );
    }

    const toAdd = candidates.slice(0, rule.count);
    for (const video of toAdd) {
      usedIds.add(video.id);
      result.push({ video, ruleSource: rule.source });
    }
  }

  return result;
}

// Applies per-site overrides from site_config onto the template's default rules.
// Overridable keys: profile_model_count, profile_similar_count, profile_similar_sort.
export function applyFeedOverrides(
  rules: FeedRule[],
  siteConfig: Record<string, unknown>
): FeedRule[] {
  return rules.map((rule) => {
    if (rule.source === "current_model" && rule.sort !== "trigger_first") {
      const count = siteConfig.profile_model_count;
      if (typeof count === "number" && count > 0) {
        return { ...rule, count };
      }
    }
    if (rule.source === "similar_category") {
      const count = siteConfig.profile_similar_count;
      const sort = siteConfig.profile_similar_sort as FeedSort | undefined;
      return {
        ...rule,
        ...(typeof count === "number" && count > 0 ? { count } : {}),
        ...(sort ? { sort } : {}),
      };
    }
    return rule;
  });
}

function sortVideos(videos: Video[], sort: FeedSort): Video[] {
  if (sort === "popular") {
    return [...videos].sort(
      (a, b) => (b.view_count || 0) - (a.view_count || 0)
    );
  }
  if (sort === "recent") {
    return [...videos].sort((a, b) => {
      const ta = a.published_at ? new Date(a.published_at).getTime() : 0;
      const tb = b.published_at ? new Date(b.published_at).getTime() : 0;
      return tb - ta;
    });
  }
  if (sort === "random_popular") {
    const sorted = [...videos].sort(
      (a, b) => (b.view_count || 0) - (a.view_count || 0)
    );
    const top = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 2)));
    return top.sort(() => Math.random() - 0.5);
  }
  // trigger_first handled by caller; ctr not yet implemented → fall back to popular
  return [...videos].sort(
    (a, b) => (b.view_count || 0) - (a.view_count || 0)
  );
}

async function fetchExternal(
  rule: FeedRule,
  account: Account,
  similarityStrategy: SimilarityStrategy
): Promise<Video[]> {
  if (rule.source === "similar_category") {
    try {
      return await similarityStrategy.fetch(
        account,
        rule.count,
        rule.sort,
        rule.filters || []
      );
    } catch {
      return [];
    }
  }
  // same_country, trending: not implemented in v1
  return [];
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd web && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/profile-feed.ts
git commit -m "feat(web): add ProfileFeedBuilder — server-side feed assembly with rule pipeline"
```

---

## Chunk 2: Wire into template and pages

### Task 4: Create `feed-config.ts` — default rules for the `default` template

This is the file you open to understand what the profile page shows.

**Files:**
- Create: `web/src/templates/default/feed-config.ts`

- [ ] **Step 1: Create the config**

```typescript
// web/src/templates/default/feed-config.ts
//
// PROFILE PAGE COMPOSITION
// ─────────────────────────────────────────────────────────────────────────────
// This file defines what appears on a model's profile page and in what order.
// To change the composition, edit profileFeedRules below.
// Per-site overrides: Admin → Websites → [site] → Display Settings → Profile Feed
//
// FeedRule fields:
//   source  — where content comes from: "current_model" | "similar_category"
//   sort    — "trigger_first" | "recent" | "popular" | "random_popular"
//   count   — max items from this rule
//   filters — (future) narrow the selection
//
// To add a new template with different rules:
//   1. Create templates/my-template/feed-config.ts with your own profileFeedRules
//   2. ProfileFeedBuilder is shared — only the config changes
// ─────────────────────────────────────────────────────────────────────────────

import type { FeedRule } from "@/lib/feed-types";
import { SameCategoryStrategy } from "@/lib/similarity/same-category";

export const profileFeedRules: FeedRule[] = [
  // 1. The video the user clicked — always first.
  //    If not in the initial 24 videos, this slot is skipped silently.
  { source: "current_model",    sort: "trigger_first", count: 1 },

  // 2. More videos from this model, newest first.
  //    Count can be overridden per site: Admin → Profile Feed → "Model videos".
  { source: "current_model",    sort: "recent",        count: 5 },

  // 3. Similar models — same category, different account, sorted by popularity.
  //    Count and sort can be overridden per site: Admin → Profile Feed → "Similar videos".
  { source: "similar_category", sort: "popular",       count: 9 },
];

// Active similarity strategy. Swap this to change how "similar" is determined:
//   - SameCategoryStrategy: same top category (current, v1)
//   - future: SameCategoryAndCountryStrategy, LLMStrategy, etc.
export const similarityStrategy = new SameCategoryStrategy();
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd web && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add web/src/templates/default/feed-config.ts
git commit -m "feat(web): add default template feed-config.ts — profile page composition rules"
```

---

### Task 5: Update `ModelPage.tsx` — use ProfileFeedBuilder, remove inline logic

Replace the inline similar-fetch + `SimilarModels` render with a single `buildProfileFeed()` call.

**Files:**
- Modify: `web/src/templates/default/pages/ModelPage.tsx`

Read the current file before editing. Key changes:
1. Remove `getVideos` import (builder handles it)
2. Remove `SimilarModels` import
3. Add imports for `buildProfileFeed`, `applyFeedOverrides`, `profileFeedRules`, `similarityStrategy`
4. Replace lines 85-101 (similarVideos fetch) with builder call
5. Pass `feedVideos` (Video[]) to `ProfileContent` instead of `videos`
6. Remove `{similarVideos.length > 0 && <SimilarModels videos={similarVideos} />}`

- [ ] **Step 1: Read the current file**

Read `web/src/templates/default/pages/ModelPage.tsx` (already in plan context above).

- [ ] **Step 2: Replace the file**

```typescript
// web/src/templates/default/pages/ModelPage.tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getAccountBySlug } from "@/lib/api";
import { SITE_NAME, SITE_URL } from "@/lib/constants";
import { buildProfileFeed, applyFeedOverrides } from "@/lib/profile-feed";
import { profileFeedRules, similarityStrategy } from "../feed-config";
// Template visual components
import { ProfileHeader } from "../ProfileHeader";
// Behavior components — not template-specific yet.
import { FanSiteButtons } from "@/app/model/[slug]/FanSiteButtons";
import { ProfileContent } from "@/app/model/[slug]/ProfileContent";
import { ProfileViewTracker } from "@/app/model/[slug]/ProfileViewTracker";
import { BreadcrumbJsonLd, ProfileJsonLd } from "@/components/JsonLd";
import { ErrorState } from "@/components/ErrorState";
import { AdLandingTracker } from "@/components/AdLandingTracker";
import { OnlyFansHeaderSetter } from "@/contexts/OnlyFansContext";

export interface ModelPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    page?: string;
    v?: string;
    src?: string;
    click_id?: string;
  }>;
}

export async function generateMetadata({
  params,
}: ModelPageProps): Promise<Metadata> {
  const { slug } = await params;
  try {
    const account = await getAccountBySlug(slug, 1, 1);
    const displayName = account.display_name || account.username;
    const cleanBio = account.bio?.replace(/\n+/g, " ").slice(0, 155);
    return {
      title: `${displayName} (@${account.username})`,
      description:
        cleanBio ||
        `Watch ${account.video_count || 0} videos from @${account.username} on ${SITE_NAME}.`,
      openGraph: {
        title: `${displayName} (@${account.username}) | ${SITE_NAME}`,
        description: cleanBio || `Videos from @${account.username}.`,
        url: `${SITE_URL}/model/${slug}`,
        images: account.avatar_url ? [{ url: account.avatar_url }] : undefined,
      },
      twitter: {
        card: "summary_large_image",
        title: `${displayName} (@${account.username}) | ${SITE_NAME}`,
        description: cleanBio || `Videos from @${account.username}.`,
        images: account.avatar_url ? [account.avatar_url] : undefined,
      },
      alternates: { canonical: `${SITE_URL}/model/${slug}` },
    };
  } catch {
    return { title: `@${slug}` };
  }
}

export default async function ModelPage({
  params,
  searchParams,
}: ModelPageProps) {
  const { slug } = await params;
  const sp = await searchParams;
  const perPage = 24;

  try {
    const account = await getAccountBySlug(slug, 1, perPage);
    if (!account || !account.id) notFound();

    const totalPages = Math.ceil((account.video_count || 0) / perPage);
    const showSocialButtons =
      account.site_config?.show_social_buttons !== false;

    const ofRaw = account.social_links?.onlyfans;
    const onlyfansUrl = ofRaw
      ? ofRaw.startsWith("http")
        ? ofRaw
        : `https://onlyfans.com/${ofRaw}`
      : null;

    // Apply per-site overrides (profile_model_count, profile_similar_count, profile_similar_sort)
    // from site_config onto the template's default rules.
    const siteConfig = (account.site_config as Record<string, unknown>) || {};
    const rules = applyFeedOverrides(profileFeedRules, siteConfig);

    // Build the initial feed: trigger video + model videos + similar.
    const feedItems = await buildProfileFeed(
      account,
      sp.v || null,
      rules,
      similarityStrategy
    );
    const feedVideos = feedItems.map((item) => item.video);

    return (
      <>
        <BreadcrumbJsonLd
          items={[
            { name: "Home", url: "/" },
            {
              name: account.display_name || `@${account.username}`,
              url: `/model/${slug}`,
            },
          ]}
        />
        <ProfileJsonLd account={account} />
        <ProfileViewTracker accountId={account.id} />
        <OnlyFansHeaderSetter
          url={onlyfansUrl}
          username={account.username}
          displayName={account.display_name || account.username}
          avatarUrl={account.avatar_url || null}
        />
        {sp.src && <AdLandingTracker source={sp.src} clickId={sp.click_id} />}
        <ProfileHeader account={account} />
        {showSocialButtons && (
          <Suspense fallback={null}>
            <FanSiteButtons account={account} />
          </Suspense>
        )}
        <ProfileContent
          account={account}
          initialVideos={feedVideos}
          totalPages={totalPages}
          slug={slug}
          perPage={perPage}
        />
      </>
    );
  } catch {
    return (
      <ErrorState
        title="Profile not found"
        message={`Could not load profile for @${slug}.`}
      />
    );
  }
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd web && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add web/src/templates/default/pages/ModelPage.tsx
git commit -m "feat(web): ModelPage uses ProfileFeedBuilder — removes inline similar fetch"
```

---

### Task 6: Update `ProfileContent.tsx` — remove `?v=` reorder logic

The reorder now happens in `buildProfileFeed` (trigger_first rule). `ProfileContent` just renders what it receives.

**Files:**
- Modify: `web/src/app/model/[slug]/ProfileContent.tsx`

- [ ] **Step 1: Replace the file**

```typescript
// web/src/app/model/[slug]/ProfileContent.tsx
"use client";

import { useCallback } from "react";
import type { Account, Video } from "@/types";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { ProfileGrid } from "./ProfileGrid";

interface ProfileContentProps {
  account: Account;
  initialVideos: Video[];
  totalPages: number;
  slug: string;
  perPage: number;
}

export function ProfileContent({
  account,
  initialVideos,
  totalPages,
  slug,
  perPage,
}: ProfileContentProps) {
  const extractItems = useCallback(
    (data: Record<string, unknown>) => (data.videos as Video[]) || [],
    []
  );

  const { items, sentinelRef, isLoading, hasMore } = useInfiniteScroll<Video>({
    initialItems: initialVideos,
    initialPage: 1,
    totalPages,
    fetchUrl: `/api/v1/accounts/slug/${encodeURIComponent(slug)}?per_page=${perPage}`,
    extractItems,
  });

  return (
    <ProfileGrid
      videos={items}
      accountId={account.id}
      sentinelRef={sentinelRef}
      isLoading={isLoading}
      hasMore={hasMore}
    />
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd web && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add web/src/app/model/[slug]/ProfileContent.tsx
git commit -m "feat(web): ProfileContent — remove ?v= reorder (now handled by feed builder)"
```

---

## Chunk 3: Cleanup and Admin UI

### Task 7: Remove `SimilarModels` — delete file and clean up references

Similar videos now flow into the unified feed grid. The separate `SimilarModels` component and its interface are no longer needed.

**Files:**
- Delete: `web/src/templates/default/SimilarModels.tsx`
- Modify: `web/src/templates/_shared/types.ts` — remove `SimilarModelsProps` and `SimilarModels` from `SiteTemplate`
- Modify: `web/src/templates/default/index.ts` — remove `SimilarModels` import and export

- [ ] **Step 1: Read current `types.ts` and `index.ts`**

Read `web/src/templates/_shared/types.ts` and `web/src/templates/default/index.ts`.

- [ ] **Step 2: Remove `SimilarModelsProps` and `SimilarModels` from `types.ts`**

In `web/src/templates/_shared/types.ts`:
- Delete the `SimilarModelsProps` interface (lines 25-27)
- Delete `SimilarModels: React.ComponentType<SimilarModelsProps>;` from `SiteTemplate`

- [ ] **Step 3: Remove `SimilarModels` from `index.ts`**

In `web/src/templates/default/index.ts`:
- Remove `import { SimilarModels } from "./SimilarModels";`
- Remove `SimilarModels,` from the exported `template` object

- [ ] **Step 4: Delete `SimilarModels.tsx`**

```bash
rm web/src/templates/default/SimilarModels.tsx
```

- [ ] **Step 5: Verify TypeScript — no remaining references**

```bash
cd web && npx tsc --noEmit 2>&1 | head -30
grep -r "SimilarModels" web/src/ --include="*.tsx" --include="*.ts"
```

Expected: TypeScript clean. `grep` returns only the deleted file path (which should show nothing since it's deleted). If any remaining references found — fix them before proceeding.

- [ ] **Step 6: Run build**

```bash
cd web && npm run build 2>&1 | tail -20
```

Expected: `✓ Compiled successfully`

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(web): remove SimilarModels component — merged into unified feed pipeline"
```

---

### Task 8: Add Profile Feed settings to Admin UI

Three override fields in `/admin/websites/{id}` → Display Settings.

**Files:**
- Modify: `web/src/lib/admin-api.ts` — add 3 fields to `SiteConfig`
- Modify: `web/src/app/admin/websites/[id]/page.tsx` — add Profile Feed section UI

- [ ] **Step 1: Read `admin-api.ts` to find `SiteConfig` interface**

Read `web/src/lib/admin-api.ts` — find the `SiteConfig` interface.

- [ ] **Step 2: Add fields to `SiteConfig`**

In `web/src/lib/admin-api.ts`, add to the `SiteConfig` interface:

```typescript
export interface SiteConfig {
  template?: string;
  show_social_buttons?: boolean;
  // Profile feed overrides — see templates/default/feed-config.ts for defaults
  profile_model_count?: number;    // default: 5
  profile_similar_count?: number;  // default: 9
  profile_similar_sort?: string;   // default: "popular"
  [key: string]: unknown;
}
```

- [ ] **Step 3: Read the admin websites page to find where to insert the Profile Feed section**

Read `web/src/app/admin/websites/[id]/page.tsx` — find the Display Settings section (around line 194). The new section goes inside the Display Settings card, after the social buttons toggle and before the Save button.

- [ ] **Step 4: Add Profile Feed section to the Display Settings card**

After the social buttons toggle (`</label>` closing tag for "Show social buttons"), before `</div>` that closes the Display Settings card, add:

```tsx
{/* Profile Feed */}
<div className="mt-4 pt-4 border-t border-[#2e2e2e]">
  <div className="text-sm text-white mb-1">Profile Feed</div>
  <p className="text-xs text-[#6b6b6b] mb-3">
    Controls what appears on a model&apos;s profile page.
    Defaults are set in{" "}
    <code className="font-mono text-[#aaa]">
      templates/default/feed-config.ts
    </code>
    .
  </p>
  <div className="grid grid-cols-3 gap-3">
    <div>
      <label className="block text-xs text-[#6b6b6b] mb-1">
        Model videos
      </label>
      <input
        type="number"
        min={1}
        max={50}
        value={config.profile_model_count ?? 5}
        onChange={(e) =>
          setConfig((prev) => ({
            ...prev,
            profile_model_count: Number(e.target.value),
          }))
        }
        className="w-full bg-[#1e1e1e] border border-[#2e2e2e] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent"
      />
    </div>
    <div>
      <label className="block text-xs text-[#6b6b6b] mb-1">
        Similar videos
      </label>
      <input
        type="number"
        min={0}
        max={50}
        value={config.profile_similar_count ?? 9}
        onChange={(e) =>
          setConfig((prev) => ({
            ...prev,
            profile_similar_count: Number(e.target.value),
          }))
        }
        className="w-full bg-[#1e1e1e] border border-[#2e2e2e] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent"
      />
    </div>
    <div>
      <label className="block text-xs text-[#6b6b6b] mb-1">
        Similar sort
      </label>
      <select
        value={config.profile_similar_sort ?? "popular"}
        onChange={(e) =>
          setConfig((prev) => ({
            ...prev,
            profile_similar_sort: e.target.value,
          }))
        }
        className="w-full bg-[#1e1e1e] border border-[#2e2e2e] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent"
      >
        <option value="popular">Popular</option>
        <option value="recent">Recent</option>
        <option value="random_popular">Random popular</option>
      </select>
    </div>
  </div>
</div>
```

- [ ] **Step 5: Verify TypeScript**

```bash
cd web && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 6: Run full build**

```bash
cd web && npm run build 2>&1 | tail -30
```

Expected: `✓ Compiled successfully`, all routes listed

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/admin-api.ts web/src/app/admin/websites/[id]/page.tsx
git commit -m "feat(web): add Profile Feed override fields to Admin UI"
```

---

## Final: Verify and push

- [ ] **Run Go tests (unchanged, should still pass)**

```bash
cd api && go test ./...
```

Expected: all `ok`

- [ ] **Run full Next.js build**

```bash
cd web && npm run build 2>&1 | tail -20
```

Expected: `✓ Compiled successfully`

- [ ] **Push to remote**

```bash
git push origin main
```

- [ ] **Deploy**

```bash
ssh traforama@37.27.189.122 "cd /opt/traforama/xcj && git pull origin main && docker compose -f deploy/docker/docker-compose.yml --env-file .env up -d --build api web 2>&1 | tail -30"
```

Expected: `traforama-api Started`, `traforama-web Started`

- [ ] **Smoke test in browser**

1. Open https://temptguide.com — home page loads
2. Click any video thumbnail → should land on `/model/{slug}?v={id}`
3. Profile page shows: clicked video first, then 5 model videos, then 9 similar
4. Open https://temptguide.com/admin/websites/1 → Display Settings → Profile Feed section visible with 3 fields

---

## How to verify the feed composition is correct

After deploying, open any profile page with `?v=` param and check the first 15 videos:
- Position 1: same video as the `v=` ID
- Positions 2-6: other videos from this model, newest first
- Positions 7-15: videos from other models (different account ID), same category

To change the composition temporarily for testing:
1. Edit `web/src/templates/default/feed-config.ts`
2. Change counts or add a rule
3. Run `npm run build` to verify TypeScript
4. Deploy
