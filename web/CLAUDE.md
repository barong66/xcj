# Next.js Frontend

Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS.

## Structure

```
src/
  app/                          App Router (SSR)
    page.tsx                    Home (ProfileStories + VideoGrid)
    layout.tsx                  Root layout, OnlyFansProvider
    (public)/
      search/page.tsx           Explore with category pills, infinite scroll
      model/[slug]/page.tsx     Model profile (video grid, Similar Models)
      video/[id]/page.tsx       Video detail
      category/[slug]/page.tsx  Category page
      country/[code]/page.tsx   Country-filtered videos
    admin/                      Admin dashboard (Bearer token auth)
      accounts/, banners/, stats/, videos/, queue/, categories/, ...

  components/ (18 files)
    Header.tsx                  Sticky profile mode (avatar + "Follow me")
    ProfileStories.tsx          Instagram Stories-style carousel (56px circles)
    VideoCard.tsx               Thumbnail + metadata, hover preview
    InfiniteVideoGrid.tsx       Infinite scroll with Intersection Observer
    CategoryGrid.tsx            Category pills (4x3 grid)
    SearchBar.tsx               Search input with debounce
    SortControls.tsx            Sort buttons (newest, popular, random)
    BottomNav.tsx               Bottom navigation (Home, Search, Shuffle)
    ViewTracker.tsx             Analytics event sender
    JsonLd.tsx                  Structured data for SEO

  lib/
    api.ts                      Public API client (fetch from Go API)
    admin-api.ts                Admin API with Bearer token
    api-proxy.ts                Server-side proxy for SSR (avoids CORS)
    analytics.ts                Event tracking (impressions, clicks)
    constants.ts                API URLs, site config from env

  contexts/
    OnlyFansContext.tsx          React Context for sticky header model info
```

## Patterns

**SSR:** Server components fetch data during SSR. `api-proxy.ts` calls Go API with `X-Forwarded-Host`.

**Sticky Profile Header:** On `/model/[slug]` and `/video/[id]`, Header shows model avatar + "Follow me" button via OnlyFansContext.

**Infinite Scroll:** InfiniteVideoGrid uses Intersection Observer, fetches next page at 80% scroll.

**SEO:** Dynamic titles (PageTitle), JSON-LD (JsonLd), sitemap.ts, robots.ts, OG images.

## Environment

```
NEXT_PUBLIC_API_URL     Client-side API URL
NEXT_PUBLIC_SITE_NAME   Site name for titles
NEXT_PUBLIC_SITE_URL    Canonical URL
API_URL                 Server-side API URL (Docker network)
ADMIN_TOKEN             Bearer token for admin
```

## Testing

```bash
npm test    # (when configured)
```

Component tests: `*.test.ts` next to components.
