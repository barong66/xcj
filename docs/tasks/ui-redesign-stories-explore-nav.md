# UI Redesign: Profile Stories, Explore Page, Bottom Nav

> Date: 2026-03-06
> Status: Done
> ClickUp: https://app.clickup.com/t/869cchqzn

---

## Summary

Instagram-style UI redesign for the home page and search/explore page. Three main changes:

1. **Profile Stories bar** on home page
2. **Search page redesigned as Explore page** (when no query)
3. **Bottom nav simplified** to 3 tabs

---

## 1. Profile Stories Bar

Instagram-style horizontal scroll row of account avatars on the home page.

- 56px circles with gradient ring (pink/orange/yellow)
- Data source: new API endpoint `GET /api/v1/accounts`
- Returns `AccountSummary`: id, username, slug, display_name, avatar_url
- Sorted by video count (most videos first)
- Redis-cached (key: `acl:{site_id}`, TTL: 60s)
- Links to `/model/{slug}`

### Files

**Backend:**
- `api/internal/store/account_store.go` — `AccountSummary` struct, `List()` method with SQL join on video count
- `api/internal/handler/account.go` — `List` handler with Redis caching
- `api/internal/handler/router.go` — registered `GET /api/v1/accounts`
- `api/internal/cache/redis.go` — `AccountListKey()` function

**Frontend:**
- `web/src/components/ProfileStories.tsx` (new) — horizontal scroll row component
- `web/src/app/page.tsx` — renders ProfileStories at top of feed
- `web/src/types/index.ts` — `AccountSummary` interface
- `web/src/lib/api.ts` — `getAccounts()` function

---

## 2. Explore Page (Search Redesign)

Search page (`/search`) now doubles as an Explore page when there is no search query.

**No query (Explore mode):**
- Search bar at top
- CategoryGrid: expandable 4x3 grid of category pills (shows 11 + "More..." button, expands to all 32 categories)
- ExploreGrid: 3-column random video thumbnails with infinite scroll

**With query (Search mode):**
- Same as before: search results

### Files

- `web/src/components/ExploreGrid.tsx` (new) — 3-column thumbnail grid, uses `useInfiniteScroll` hook, fetches random videos
- `web/src/components/CategoryGrid.tsx` (new) — expandable category pills grid
- `web/src/app/search/page.tsx` — redesigned to use CategoryGrid + ExploreGrid

---

## 3. Bottom Nav Cleanup

Removed the Categories tab from bottom navigation. Now 3 tabs:
- Home
- Search
- Shuffle

### Files

- `web/src/components/BottomNav.tsx` — removed Categories tab

---

## 4. SQL Fix

`SELECT DISTINCT` with `ORDER BY RANDOM()` caused a PostgreSQL error. Fixed by replacing `SELECT DISTINCT` with `GROUP BY v.id`.

### Files

- `api/internal/store/video_store.go`

---

## 5. Data Fix

Linked all 41 active categories to temptguide.com site:

```sql
INSERT INTO site_categories (site_id, category_id)
SELECT 1, id FROM categories WHERE is_active = true;
```

---

## Follow-up Tasks

- [ ] Add analytics tracking to ExploreGrid thumbnails (impressions/clicks)
- [ ] Add click tracking to ProfileStories avatars
- [ ] Add category click tracking to CategoryGrid pills
- [ ] Consider adding "Trending" section to Explore page above random grid
