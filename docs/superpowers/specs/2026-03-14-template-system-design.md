# Template System Design

**Date:** 2026-03-14
**Status:** Approved

## Summary

A per-site template system where each site independently selects a full UI layout from the database. One Docker image contains all templates; no rebuild required to launch a new site.

---

## Key Decisions

| Question | Decision |
|---|---|
| What is a template? | Full UI-kit — different page structures, not just colors |
| How is a template selected? | Per-request from `site_config.template` in DB |
| What does a template control? | Full pages (`page.tsx`) + all components |
| Implementation approach | Dynamic page loader with Node.js module cache |
| CSS injection | Server-side `<style>` in `layout.tsx` — no flash |
| Banners | Not part of templates — served by Go API independently |

---

## Architecture

### Directory Structure

```
web/src/
  app/                            ← thin shells, no logic
    layout.tsx                    ← fetches site_config, injects CSS vars
    page.tsx                      ← loadTemplatePage('home', props)
    model/[slug]/page.tsx         ← loadTemplatePage('model', props)
    explore/page.tsx              ← loadTemplatePage('explore', props)

  lib/
    site-config.ts                ← getSiteConfig() — cached 5 min per domain

  templates/
    _shared/
      types.ts                    ← SiteTemplate interface, page props types
      loader.ts                   ← loadTemplatePage() with fallback to default
      registry.ts                 ← template name → SiteTemplate map
      TemplateContext.tsx         ← useTemplate() for client components

    default/                      ← current design (Instagram-style dark)
      DESIGN.md
      theme.ts
      pages/
        HomePage.tsx
        ModelPage.tsx
        ExplorePage.tsx
      components/
        VideoCard.tsx
        Header.tsx
        BottomNav.tsx
        Footer.tsx
        ProfileGrid.tsx
        ProfileHeader.tsx
        SimilarModels.tsx
      index.ts

    magazine/                     ← future template (empty stub)
      DESIGN.md
```

### App Routes (thin shells)

Every `app/**/page.tsx` is 3 lines:

```tsx
import { loadTemplatePage } from '@/templates/_shared/loader'

export default async function Page(props) {
  const { HomePage } = await loadTemplatePage('home')
  return <HomePage {...props} />
}
```

---

## Site Config Fetching

Domain in URL (not header) ensures correct Next.js cache key:

```ts
// lib/site-config.ts
import { headers } from 'next/headers'

export async function getSiteConfig() {
  const domain = (await headers()).get('host') || 'localhost'
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/api/v1/config?domain=${domain}`,
    { next: { revalidate: 300, tags: [`site-config-${domain}`] } }
  )
  const data = await res.json()
  return data.data
}
```

**Performance:** Next.js Data Cache + Go API Redis cache = ~1 Go API call per 5 min per domain. Handles 100k+ visits/day comfortably.

---

## Template Loader

```ts
// templates/_shared/loader.ts
import { getSiteConfig } from '@/lib/site-config'

export async function loadTemplatePage(pageName: string) {
  const config = await getSiteConfig()
  const name = config?.template || 'default'
  try {
    return await import(`@/templates/${name}/pages/${pageName}`)
  } catch {
    return await import(`@/templates/default/pages/${pageName}`)
  }
}
```

Dynamic imports are cached by Node.js module system after first load — no repeated I/O.

---

## CSS Variables — No Flash

Injected server-side in `app/layout.tsx`:

```tsx
export default async function RootLayout({ children }) {
  const config = await getSiteConfig()
  const template = getTemplate(config?.template || 'default')

  const cssVars = Object.entries(template.theme.cssVars)
    .map(([k, v]) => `${k}:${v}`)
    .join(';')

  return (
    <html>
      <head>
        <style>{`:root{${cssVars}}`}</style>
      </head>
      <body>{children}</body>
    </html>
  )
}
```

---

## Go API — New Endpoint

**`GET /api/v1/config`** — public, no auth required.

- Reads site from `X-Forwarded-Host` (middleware already wired)
- Returns `site_config` from `sites` table including `template` field

```json
{
  "data": {
    "domain": "temptguide.com",
    "name": "TemptGuide",
    "template": "default",
    "site_config": {}
  },
  "status": "ok"
}
```

---

## What Is NOT in Templates

- **Banner system** — served by Go API at `/b/serve`, embedded on external partner sites
- **Admin pages** — `app/admin/**` have no template, own layout
- **Analytics/postbacks** — server-side Go API logic, unaffected

---

## Adding a New Template

1. Create `templates/magazine/` with `DESIGN.md`, `theme.ts`, `pages/`, `components/`, `index.ts`
2. Add one line to `templates/_shared/registry.ts`
3. In Admin → Websites → set `template: "magazine"`
4. No rebuild needed

---

## Migration from Current State

Current issues to fix as part of this implementation:
1. `NEXT_PUBLIC_TEMPLATE` (per-build) → replace with `getSiteConfig()` (per-request)
2. CSS vars defined in `theme.ts` but never injected → fix in `layout.tsx`
3. `Footer` exported from template but never rendered → add to `SiteLayout`
4. Some components not yet templatized (SortControls, CategoryGrid, SearchBar, ProfileStories, ExploreGrid) → move to `templates/default/`
5. Go API missing `GET /api/v1/config` endpoint → add
