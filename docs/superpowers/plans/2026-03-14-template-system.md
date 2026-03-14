# Template System Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a per-site template system where each site selects a full UI layout from the database — one Docker image, all templates bundled, no rebuild needed to add new sites.

**Architecture:** `app/layout.tsx` (Server Component) fetches `site_config` from Go API, injects CSS vars server-side, wraps the app in `TemplateProvider`. Dynamic page loader reads the current template at request time from a static registry. Pages move to `templates/default/pages/` making each template fully self-contained.

**Tech Stack:** Next.js 14 App Router, Go 1.22, React Context, chi router, pgx

**Spec:** `docs/superpowers/specs/2026-03-14-template-system-design.md`

**Scope note:** This plan moves 3 of 5 public routes to templates (`/`, `/model/[slug]`, `/search`). Routes `/video/[id]`, `/category/[slug]`, `/country/[code]` remain in `app/` and continue working unchanged — they will be migrated in a future task when a second template is created.

**Route note:** The spec shows `ExplorePage.tsx` and `/explore` — the actual codebase uses `/search/page.tsx`. This plan uses the existing `/search` route name.

---

## Chunk 1: Go API — Public Config Endpoint

### Files
- Create: `api/internal/handler/config.go`
- Modify: `api/internal/handler/router.go` (add route in `/api/v1` group)
- Create: `api/internal/handler/config_test.go`

---

### Task 1.1: Write failing test for GET /api/v1/config

- [ ] **Step 1: Write the failing test**

Create `api/internal/handler/config_test.go`:

```go
package handler_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/xcj/videosite-api/internal/handler"
	"github.com/xcj/videosite-api/internal/middleware"
	"github.com/xcj/videosite-api/internal/model"
)

func TestConfigHandler_GetSiteConfig(t *testing.T) {
	h := handler.NewConfigHandler()

	t.Run("returns site config", func(t *testing.T) {
		site := &model.Site{
			ID:     1,
			Domain: "temptguide.com",
			Name:   "TemptGuide",
			Config: json.RawMessage(`{"template":"default"}`),
		}

		req := httptest.NewRequest("GET", "/api/v1/config", nil)
		req = req.WithContext(middleware.WithSite(req.Context(), site))
		w := httptest.NewRecorder()

		h.GetSiteConfig(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", w.Code)
		}

		var resp map[string]interface{}
		json.NewDecoder(w.Body).Decode(&resp)

		if resp["status"] != "ok" {
			t.Errorf("expected status ok, got %v", resp["status"])
		}
		data := resp["data"].(map[string]interface{})
		if data["domain"] != "temptguide.com" {
			t.Errorf("expected domain temptguide.com, got %v", data["domain"])
		}
	})
}
```

- [ ] **Step 2: Check `middleware.WithSite` — read `api/internal/middleware/site.go`**

The file uses `siteContextKey` (unexported). We need to expose a `WithSite` helper for tests:

```go
// Add to api/internal/middleware/site.go after line 22:

// WithSite injects a site into context. Used in tests.
func WithSite(ctx context.Context, site *model.Site) context.Context {
    return context.WithValue(ctx, siteContextKey, site)
}
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd api && go test ./internal/handler/ -run TestConfigHandler -v
```

Expected: compile error — `handler.NewConfigHandler` not defined.

---

### Task 1.2: Implement config handler

- [ ] **Step 1: Create `api/internal/handler/config.go`**

```go
package handler

import (
	"net/http"

	"github.com/xcj/videosite-api/internal/middleware"
)

type ConfigHandler struct{}

func NewConfigHandler() *ConfigHandler {
	return &ConfigHandler{}
}

// GetSiteConfig returns public site configuration for the current domain.
// Used by Next.js SSR to determine template and site settings.
func (h *ConfigHandler) GetSiteConfig(w http.ResponseWriter, r *http.Request) {
	site := middleware.SiteFromContext(r.Context())
	if site == nil {
		writeError(w, http.StatusNotFound, "site not found", "SITE_NOT_FOUND")
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"domain": site.Domain,
		"name":   site.Name,
		"config": site.Config,
	})
}
```

- [ ] **Step 2: Add route to `api/internal/handler/router.go`**

In the `/api/v1` route group (after line ~175 where `eventHandler` is defined), add:

```go
// Site config (public — no auth required).
configHandler := NewConfigHandler()
r.Get("/config", configHandler.GetSiteConfig)
```

- [ ] **Step 3: Run test to verify it passes**

```bash
cd api && go test ./internal/handler/ -run TestConfigHandler -v
```

Expected: PASS

- [ ] **Step 4: Run all Go tests**

```bash
cd api && go test ./...
```

Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add api/internal/handler/config.go api/internal/handler/config_test.go api/internal/handler/router.go api/internal/middleware/site.go
git commit -m "feat(api): add GET /api/v1/config public endpoint"
```

---

## Chunk 2: Next.js — Site Config + CSS Injection + Fix SiteLayout

### Files
- Create: `web/src/lib/site-config.ts`
- Modify: `web/src/app/layout.tsx`
- Modify: `web/src/components/SiteLayout.tsx`

---

### Task 2.1: Create `web/src/lib/site-config.ts`

- [ ] **Step 1: Create the file**

```ts
// web/src/lib/site-config.ts
import { headers } from "next/headers";

export interface SiteConfigResponse {
  domain: string;
  name: string;
  config: {
    template?: string;
    show_social_buttons?: boolean;
    [key: string]: unknown;
  };
}

export async function getSiteConfig(): Promise<SiteConfigResponse | null> {
  const hdrs = await headers();
  const domain = hdrs.get("host") || "localhost";

  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/api/v1/config?domain=${domain}`,
      {
        next: {
          revalidate: 300,
          tags: [`site-config-${domain}`],
        },
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.data ?? null;
  } catch {
    return null;
  }
}
```

**Note:** The `?domain=` query param is intentional — it makes the cache key unique per domain. Without it, Next.js would cache the same response for all sites.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd web && npx tsc --noEmit
```

Expected: no errors for this file.

---

### Task 2.2: Update `app/layout.tsx` — CSS injection + TemplateProvider

Current `app/layout.tsx` is a Server Component with static `metadata`. We need to:
1. Fetch site config at request time
2. Inject CSS vars as a `<style>` tag (server-side, no flash)
3. Wrap body in `TemplateProvider` (replaces `SiteLayout`'s current TemplateProvider)

- [ ] **Step 1: Read current `web/src/app/layout.tsx`** (already done — lines 1–54 above)

- [ ] **Step 2: Rewrite `web/src/app/layout.tsx`**

**Important:** Replace static `export const metadata` with `generateMetadata()` so the site name comes from the DB per-request, not from a build-time env var. This is required for multi-site deployments where each site has a different name.

```tsx
// web/src/app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";
import { SiteLayout } from "@/components/SiteLayout";
import { TemplateProvider } from "@/templates/_shared/TemplateContext";
import { getTemplate } from "@/templates/_shared/registry";
import { getSiteConfig } from "@/lib/site-config";
import { SITE_URL } from "@/lib/constants";

export async function generateMetadata(): Promise<Metadata> {
  const siteConfig = await getSiteConfig();
  const siteName = siteConfig?.name || "TemptGuide";

  return {
    title: {
      default: `${siteName} - Trending Videos from Twitter & Instagram`,
      template: `%s | ${siteName}`,
    },
    description:
      "Discover trending videos from Twitter and Instagram. Browse by category, country, or search for your favorite content.",
    metadataBase: new URL(SITE_URL),
    openGraph: {
      type: "website",
      siteName,
      title: `${siteName} - Trending Videos from Twitter & Instagram`,
      description:
        "Discover trending videos from Twitter and Instagram. Browse by category, country, or search for your favorite content.",
      url: SITE_URL,
    },
    twitter: {
      card: "summary_large_image",
      title: `${siteName} - Trending Videos`,
      description: "Discover trending videos from Twitter and Instagram.",
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-video-preview": -1,
        "max-image-preview": "large",
        "max-snippet": -1,
      },
    },
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const siteConfig = await getSiteConfig();
  const templateName = siteConfig?.config?.template || "default";
  const template = getTemplate(templateName);

  const cssVars = Object.entries(template.theme.cssVars)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");

  return (
    <html lang="en">
      <head>
        <style>{`:root{${cssVars}}`}</style>
      </head>
      <body className="min-h-screen flex flex-col bg-bg text-txt">
        <TemplateProvider name={templateName}>
          <SiteLayout>{children}</SiteLayout>
        </TemplateProvider>
      </body>
    </html>
  );
}
```

---

### Task 2.3: Update `SiteLayout.tsx` — remove TemplateProvider, add Footer

`SiteLayout` no longer needs to create `TemplateProvider` (done in `layout.tsx`). It only needs to use `useTemplate()` and render Header + main + BottomNav + Footer.

- [ ] **Step 1: Rewrite `web/src/components/SiteLayout.tsx`**

```tsx
// web/src/components/SiteLayout.tsx
"use client";

import { usePathname } from "next/navigation";
import { OnlyFansProvider } from "@/contexts/OnlyFansContext";
import { useTemplate } from "@/templates/_shared/TemplateContext";

function SiteContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { Header, BottomNav, Footer } = useTemplate();

  if (pathname.startsWith("/admin")) {
    return <>{children}</>;
  }

  return (
    <OnlyFansProvider>
      <Header />
      <main className="flex-1 w-full max-w-[430px] mx-auto pb-14">
        {children}
      </main>
      <BottomNav />
      <Footer />
    </OnlyFansProvider>
  );
}

export function SiteLayout({ children }: { children: React.ReactNode }) {
  return <SiteContent>{children}</SiteContent>;
}
```

**Key changes:**
- Removed `TemplateProvider` wrapper (now in `app/layout.tsx`)
- Removed `const templateName = process.env.NEXT_PUBLIC_TEMPLATE || "default"`
- Added `Footer` from template

- [ ] **Step 2: Build to verify**

```bash
cd web && npm run build
```

Expected: build succeeds. Watch for TypeScript errors about `Footer` not being in `SiteTemplate` — if so, check `web/src/templates/_shared/types.ts` and ensure `Footer` is in the interface.

- [ ] **Step 3: Check `NEXT_PUBLIC_API_URL` is set in `.env`**

```bash
grep NEXT_PUBLIC_API_URL /Users/vsevolod/Documents/asg/Traforama/claude/xcj/.env
```

If missing, add it. In development it should be `http://localhost:8080`. In production, the internal API URL.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/site-config.ts web/src/app/layout.tsx web/src/components/SiteLayout.tsx
git commit -m "feat(web): per-request template from site_config, CSS vars server-side injection"
```

---

## Chunk 3: Move Pages to templates/default/pages/

This makes the `default` template fully self-contained. Pages in `app/` become thin 3-line shells.

### Files
- Create: `web/src/templates/_shared/loader.ts`
- Create: `web/src/templates/default/pages/HomePage.tsx`
- Create: `web/src/templates/default/pages/ModelPage.tsx`
- Create: `web/src/templates/default/pages/SearchPage.tsx`
- Modify: `web/src/templates/_shared/registry.ts` (add pages map)
- Modify: `web/src/app/page.tsx` (thin shell)
- Modify: `web/src/app/model/[slug]/page.tsx` (thin shell)
- Modify: `web/src/app/search/page.tsx` (thin shell)

---

### Task 3.1: Create page loader infrastructure

- [ ] **Step 1: Update `web/src/templates/_shared/registry.ts` to add page loaders**

Read current file first (`web/src/templates/_shared/registry.ts`), then add.

**Why static imports (not dynamic template literals):** `await import(\`@/templates/${name}/pages/...\`)` with a variable string cannot be statically analyzed by webpack/turbopack — the bundler won't know which modules to include. The explicit static map below lets the bundler find all imports at build time.

```ts
// web/src/templates/_shared/registry.ts
import { template as defaultTemplate } from "../default";
import type { SiteTemplate } from "./types";

export const templates: Record<string, SiteTemplate> = {
  default: defaultTemplate,
};

export function getTemplate(name: string): SiteTemplate {
  return templates[name] ?? templates.default;
}

// Static page loader map — static imports so bundler can analyze them.
// Add new templates here when creating them.
export const pageLoaders: Record<string, Record<string, () => Promise<any>>> = {
  default: {
    home: () => import("../default/pages/HomePage"),
    model: () => import("../default/pages/ModelPage"),
    search: () => import("../default/pages/SearchPage"),
  },
};
```

- [ ] **Step 2: Create `web/src/templates/_shared/loader.ts`**

```ts
// web/src/templates/_shared/loader.ts
import { getSiteConfig } from "@/lib/site-config";
import { pageLoaders } from "./registry";

export async function loadTemplatePage(pageName: "home" | "model" | "search") {
  const config = await getSiteConfig();
  const name = config?.config?.template || "default";
  const loaders = pageLoaders[name] ?? pageLoaders.default;
  const loader = loaders[pageName] ?? loaders.home;
  return loader();
}
```

---

### Task 3.2: Move HomePage to `templates/default/pages/`

- [ ] **Step 1: Read current `web/src/app/page.tsx`** (done above — full content known)

- [ ] **Step 2: Create `web/src/templates/default/pages/HomePage.tsx`**

Move the full page logic here. This is an exact copy of `app/page.tsx` content, with `generateMetadata` included:

```tsx
// web/src/templates/default/pages/HomePage.tsx
import type { Metadata } from "next";
import { Suspense } from "react";
import { getVideos } from "@/lib/api";
import { SITE_NAME, SITE_URL } from "@/lib/constants";
import type { SortOption } from "@/types";
import { InfiniteVideoGrid } from "@/components/InfiniteVideoGrid";
import { SortControls } from "@/components/SortControls";
import { WebsiteJsonLd } from "@/components/JsonLd";
import { ErrorState } from "@/components/ErrorState";
import { AdLandingTracker } from "@/components/AdLandingTracker";
import { ProfileStories } from "@/components/ProfileStories";

export interface HomePageProps {
  searchParams: Promise<{
    sort?: string;
    page?: string;
    anchor?: string;
    src?: string;
  }>;
}

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: `${SITE_NAME} - Trending Videos from Twitter & Instagram`,
    description:
      "Discover the latest trending videos from Twitter and Instagram. Browse by category, filter by country, and watch previews instantly.",
    alternates: {
      canonical: SITE_URL,
    },
  };
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const sort = (params.sort as SortOption) || "recent";
  const page = parseInt(params.page || "1", 10);
  const anchor = params.anchor || "";
  const src = params.src || "";

  try {
    const data = await getVideos({
      sort,
      page,
      per_page: 12,
      anchor: anchor || undefined,
      src: src || undefined,
    });

    return (
      <>
        <WebsiteJsonLd searchUrl="/search" />
        <h1 className="sr-only">Trending Videos from Twitter & Instagram</h1>
        {src && <AdLandingTracker source={src} anchor={anchor} />}
        {!anchor && (
          <Suspense fallback={null}>
            <ProfileStories />
          </Suspense>
        )}
        {!anchor && (
          <div className="px-4 py-2">
            <Suspense fallback={null}>
              <SortControls currentSort={sort} />
            </Suspense>
          </div>
        )}
        <InfiniteVideoGrid
          initialVideos={data.videos}
          initialPage={data.page}
          totalPages={data.pages}
          sort={sort}
          anchor={anchor || undefined}
          src={src || undefined}
        />
      </>
    );
  } catch {
    return (
      <ErrorState message="Could not load videos. The API server may be unavailable." />
    );
  }
}
```

- [ ] **Step 3: Replace `web/src/app/page.tsx` with thin shell**

```tsx
// web/src/app/page.tsx
import { loadTemplatePage } from "@/templates/_shared/loader";
import type { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
  const mod = await loadTemplatePage("home");
  return mod.generateMetadata?.() ?? {};
}

export default async function Page(
  props: React.ComponentProps<React.ComponentType>
) {
  const mod = await loadTemplatePage("home");
  const HomePage = mod.default;
  return <HomePage {...props} />;
}
```

---

### Task 3.3: Move ModelPage to `templates/default/pages/`

- [ ] **Step 1: Create `web/src/templates/default/pages/ModelPage.tsx`**

Copy full logic from `web/src/app/model/[slug]/page.tsx`. Note: this file imports from `./ProfileHeader`, `./FanSiteButtons`, etc. (relative imports from `app/model/[slug]/`). Update these to absolute imports:

```tsx
// web/src/templates/default/pages/ModelPage.tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getAccountBySlug, getVideos } from "@/lib/api";
import { SITE_NAME, SITE_URL } from "@/lib/constants";
// Import from THIS template's own components (not from app/model/[slug]/)
// so future templates can override these visuals independently.
import { ProfileHeader } from "../ProfileHeader";
import { SimilarModels } from "../SimilarModels";
// FanSiteButtons, ProfileContent, ProfileViewTracker are behavior components,
// not template visuals — import from app/ until they need per-template variants.
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
    const videos = account.videos || [];
    const showSocialButtons =
      account.site_config?.show_social_buttons !== false;

    const ofRaw = account.social_links?.onlyfans;
    const onlyfansUrl = ofRaw
      ? ofRaw.startsWith("http")
        ? ofRaw
        : `https://onlyfans.com/${ofRaw}`
      : null;

    let similarVideos: import("@/types").Video[] = [];
    if (!account.is_paid && videos.length > 0) {
      const topCategory = videos[0]?.categories?.[0]?.slug;
      if (topCategory) {
        try {
          const related = await getVideos({
            category: topCategory,
            exclude_account_id: account.id,
            per_page: 9,
            sort: "popular",
          });
          similarVideos = related.videos || [];
        } catch {
          // Silently fail — similar models section is optional.
        }
      }
    }

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
          initialVideos={videos}
          totalPages={totalPages}
          slug={slug}
          perPage={perPage}
        />
        {similarVideos.length > 0 && <SimilarModels videos={similarVideos} />}
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

- [ ] **Step 2: Replace `web/src/app/model/[slug]/page.tsx` with thin shell**

```tsx
// web/src/app/model/[slug]/page.tsx
import type { Metadata } from "next";
import { loadTemplatePage } from "@/templates/_shared/loader";

interface ModelPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    page?: string;
    v?: string;
    src?: string;
    click_id?: string;
  }>;
}

export async function generateMetadata(props: ModelPageProps): Promise<Metadata> {
  const mod = await loadTemplatePage("model");
  return mod.generateMetadata?.(props) ?? {};
}

export default async function Page(props: ModelPageProps) {
  const mod = await loadTemplatePage("model");
  const ModelPage = mod.default;
  return <ModelPage {...props} />;
}
```

---

### Task 3.4: Move SearchPage to `templates/default/pages/`

- [ ] **Step 1: Create `web/src/templates/default/pages/SearchPage.tsx`**

Copy full logic from `web/src/app/search/page.tsx`:

```tsx
// web/src/templates/default/pages/SearchPage.tsx
import type { Metadata } from "next";
import { Suspense } from "react";
import { searchVideos, getCategories, getVideos } from "@/lib/api";
import { SITE_NAME, SITE_URL } from "@/lib/constants";
import { InfiniteVideoGrid } from "@/components/InfiniteVideoGrid";
import { ExploreGrid } from "@/components/ExploreGrid";
import { CategoryGrid } from "@/components/CategoryGrid";
import { SearchBar } from "@/components/SearchBar";
import { ErrorState } from "@/components/ErrorState";

export interface SearchPageProps {
  searchParams: Promise<{ q?: string; page?: string }>;
}

export async function generateMetadata({
  searchParams,
}: SearchPageProps): Promise<Metadata> {
  const params = await searchParams;
  const query = params.q || "";
  return {
    title: query ? `Search: ${query}` : "Explore",
    description: query
      ? `Search results for "${query}" on ${SITE_NAME}.`
      : `Explore trending videos on ${SITE_NAME}.`,
    openGraph: {
      title: query
        ? `Search: ${query} | ${SITE_NAME}`
        : `Explore | ${SITE_NAME}`,
      url: `${SITE_URL}/search${query ? `?q=${encodeURIComponent(query)}` : ""}`,
    },
    robots: { index: false, follow: true },
  };
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const query = params.q || "";
  const page = parseInt(params.page || "1", 10);

  if (!query) {
    let categories;
    let videos;
    try {
      [categories, videos] = await Promise.all([
        getCategories(),
        getVideos({ sort: "random", per_page: 12 }),
      ]);
    } catch {
      return <ErrorState message="Could not load explore page." />;
    }
    return (
      <>
        <div className="px-4 pt-4 pb-3">
          <Suspense fallback={null}>
            <SearchBar />
          </Suspense>
        </div>
        <CategoryGrid categories={categories} />
        <ExploreGrid
          initialVideos={videos.videos}
          initialPage={videos.page}
          totalPages={videos.pages}
        />
      </>
    );
  }

  try {
    const data = await searchVideos({ q: query, page, per_page: 12 });
    return (
      <>
        <div className="px-4 pt-4 pb-2">
          <Suspense fallback={null}>
            <SearchBar />
          </Suspense>
          <p className="text-txt-muted text-[13px] mt-3">
            {data.total} result{data.total !== 1 ? "s" : ""} for &ldquo;
            {query}&rdquo;
          </p>
        </div>
        <InfiniteVideoGrid
          initialVideos={data.videos}
          initialPage={data.page}
          totalPages={data.pages}
          searchQuery={query}
        />
      </>
    );
  } catch {
    return <ErrorState message={`Could not search for "${query}".`} />;
  }
}
```

- [ ] **Step 2: Replace `web/src/app/search/page.tsx` with thin shell**

```tsx
// web/src/app/search/page.tsx
import type { Metadata } from "next";
import { loadTemplatePage } from "@/templates/_shared/loader";

interface SearchPageProps {
  searchParams: Promise<{ q?: string; page?: string }>;
}

export async function generateMetadata(
  props: SearchPageProps
): Promise<Metadata> {
  const mod = await loadTemplatePage("search");
  return mod.generateMetadata?.(props) ?? {};
}

export default async function Page(props: SearchPageProps) {
  const mod = await loadTemplatePage("search");
  const SearchPage = mod.default;
  return <SearchPage {...props} />;
}
```

- [ ] **Step 3: Build to verify**

```bash
cd web && npm run build
```

Expected: clean build, no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/templates/ web/src/app/page.tsx web/src/app/model/[slug]/page.tsx web/src/app/search/page.tsx
git commit -m "feat(web): move pages to templates/default/pages, thin shell routing"
```

---

## Chunk 4: Templatize Remaining Components

`ProfileStories` and `SortControls` are used in `HomePage` but live in `components/`. They should be in the template so a future template can override them.

### Files
- Create: `web/src/templates/default/components/ProfileStories.tsx` (re-export wrapper)
- Create: `web/src/templates/default/components/SortControls.tsx` (re-export wrapper)
- Modify: `web/src/templates/_shared/types.ts` (add optional components)
- Modify: `web/src/templates/default/index.ts` (add new exports)

**Note:** At this stage we wrap/re-export from `components/` rather than moving, to avoid breaking other consumers. A future cleanup can move the originals.

---

### Task 4.1: Add ProfileStories and SortControls to default template

- [ ] **Step 1: Read `web/src/templates/_shared/types.ts`** to see current interface

- [ ] **Step 2: Add optional components to `SiteTemplate` interface**

In `web/src/templates/_shared/types.ts`, add optional fields:

```ts
// Add to SiteTemplate interface:
ProfileStories?: React.ComponentType;
SortControls?: React.ComponentType<{ currentSort: string }>;
```

- [ ] **Step 3: Create `web/src/templates/default/components/ProfileStories.tsx`**

```tsx
// web/src/templates/default/components/ProfileStories.tsx
export { ProfileStories } from "@/components/ProfileStories";
```

- [ ] **Step 4: Create `web/src/templates/default/components/SortControls.tsx`**

```tsx
// web/src/templates/default/components/SortControls.tsx
export { SortControls } from "@/components/SortControls";
```

- [ ] **Step 5: Add to `web/src/templates/default/index.ts`**

Read current `index.ts`, then add:

```ts
import { ProfileStories } from "./components/ProfileStories";
import { SortControls } from "./components/SortControls";

// Add to the template object:
export const template: SiteTemplate = {
  // ... existing fields
  ProfileStories,
  SortControls,
};
```

- [ ] **Step 6: Build to verify**

```bash
cd web && npm run build
```

Expected: clean build.

- [ ] **Step 7: Run Go tests**

```bash
cd api && go test ./...
```

Expected: all PASS.

- [ ] **Step 8: Final commit**

```bash
git add web/src/templates/
git commit -m "feat(web): add ProfileStories and SortControls to default template"
```

---

## Verification Checklist

After all chunks are complete:

- [ ] `GET /api/v1/config` returns `{"data":{"domain":"...","name":"...","config":{"template":"default"}},"status":"ok"}`
- [ ] Changing `template` in Admin → Websites → site_config → within 5 min site reloads with new template
- [ ] No `NEXT_PUBLIC_TEMPLATE` references remain in active code
- [ ] Page source has `<style>:root{--bg:#0f0f0f;...}</style>` (CSS vars in HTML, not injected by JS)
- [ ] Footer renders on all public pages
- [ ] Model page opens without 404 at `temptguide.com/model/hannazuki`
- [ ] Build passes: `cd web && npm run build`
- [ ] Go tests pass: `cd api && go test ./...`

---

## Adding a Second Template (future reference)

1. Create `web/src/templates/magazine/` with `DESIGN.md`, `theme.ts`, `pages/`, `components/`, `index.ts`
2. In `web/src/templates/_shared/registry.ts`:
   - Add `magazine: magazineTemplate` to `templates`
   - Add `magazine: { home: ..., model: ..., search: ... }` to `pageLoaders`
3. In Admin → Websites → set `config.template = "magazine"`
4. No rebuild needed
