# Template System

**Date:** 2026-03-14
**Status:** Done
**ClickUp:** https://app.clickup.com/t/869cfwrp4

## Summary

Implements a pluggable UI template system for the Next.js frontend. Allows different visual designs per site/deployment, activated via a single environment variable. Also includes a fix for model page 404 on accounts with NULL slug.

---

## Bug Fix: Model Page 404 (NULL slug accounts)

### Root Cause

Accounts can have a NULL `slug` column in PostgreSQL. The frontend built model page URLs using `account.slug || account.username` (JavaScript fallback), so the URL would correctly use the username. However, the Go API `AccountStore.GetBySlug()` used `WHERE slug = $1`, which never matches NULL — causing 404 for all accounts where slug is not set.

### Fix

**`api/internal/store/account_store.go`**

```go
// Before
WHERE slug = $1

// After
WHERE COALESCE(slug, username) = $1
```

### Cleanup: Unused `u=` URL Param

The `modelHref` in VideoCard and ExploreGrid was appending `&u=<original_url>` as a query param that was never read on the model page.

**Files changed:**
- `web/src/components/VideoCard.tsx` — removed `&u=${encodeURIComponent(video.original_url)}`
- `web/src/components/ExploreGrid.tsx` — same
- `web/src/app/model/[slug]/page.tsx` — removed `u?: string` from `searchParams` type

---

## Feature: Template System

### Architecture

```
web/src/templates/
├── _shared/
│   ├── types.ts              — SiteTemplate interface
│   ├── registry.ts           — template registry
│   └── TemplateContext.tsx   — TemplateProvider + useTemplate() hook
└── default/                  — built-in default template
    ├── VideoCard.tsx
    ├── Header.tsx
    ├── BottomNav.tsx
    ├── Footer.tsx
    ├── ProfileGrid.tsx
    ├── ProfileHeader.tsx
    ├── SimilarModels.tsx
    ├── theme.ts
    ├── index.ts
    └── DESIGN.md
```

### SiteTemplate Interface

```typescript
// web/src/templates/_shared/types.ts
interface SiteTemplate {
  name: string;
  VideoCard: React.ComponentType<VideoCardProps>;
  Header: React.ComponentType<HeaderProps>;
  BottomNav: React.ComponentType<BottomNavProps>;
  Footer: React.ComponentType;
  ProfileGrid: React.ComponentType<ProfileGridProps>;
  ProfileHeader: React.ComponentType<ProfileHeaderProps>;
  SimilarModels: React.ComponentType<SimilarModelsProps>;
}
```

### Template Registry

```typescript
// web/src/templates/_shared/registry.ts
// Adding a template = 1 line:
const registry: Record<string, () => Promise<SiteTemplate>> = {
  default: () => import('../default').then(m => m.default),
  // magazine: () => import('../magazine').then(m => m.default),
};
```

### TemplateProvider + useTemplate()

```typescript
// web/src/templates/_shared/TemplateContext.tsx
// Used in SiteLayout to wrap the entire app:
<TemplateProvider templateName={process.env.NEXT_PUBLIC_TEMPLATE}>
  {children}
</TemplateProvider>

// Used in any component:
const template = useTemplate();
return <template.VideoCard video={video} />;
```

### Integration Points

All user-facing visual components now delegate to the active template:

| File | Change |
|------|--------|
| `web/src/components/SiteLayout.tsx` | Wraps app in `TemplateProvider`; renders `template.Header` and `template.BottomNav` |
| `web/src/components/VideoCard.tsx` | Returns `<template.VideoCard {...props} />` |
| `web/src/app/model/[slug]/ProfileGrid.tsx` | Returns `<template.ProfileGrid {...props} />` |
| `web/src/app/model/[slug]/ProfileHeader.tsx` | Returns `<template.ProfileHeader {...props} />` |
| `web/src/app/model/[slug]/SimilarModels.tsx` | Returns `<template.SimilarModels {...props} />` |

### Admin Template Selector

The website config page in admin (`/admin/websites/[id]`) now includes a template selector dropdown. The selected value is saved as `template` in `sites.config` JSONB.

**TypeScript types updated:**
- `web/src/types/index.ts` — added `template?: string` to `SiteConfig`
- `web/src/lib/admin-api.ts` — added `template?: string` to `SiteConfig`

### Template Activation

Set `NEXT_PUBLIC_TEMPLATE=<name>` in the site's `.env`. Defaults to `default` if not set or name not found in registry.

**Note:** `NEXT_PUBLIC_` variables in Next.js are inlined at build time. Changing the template requires rebuilding the web container.

### How to Add a New Template

1. Create `web/src/templates/<name>/` directory
2. Implement all components from the `SiteTemplate` interface
3. Export a `SiteTemplate` object from `index.ts`
4. Register in `web/src/templates/_shared/registry.ts` (one line)
5. Activate: `NEXT_PUBLIC_TEMPLATE=<name>` in `.env` + rebuild

---

## Follow-up Tasks

| Task | ClickUp |
|------|---------|
| Add `NEXT_PUBLIC_TEMPLATE` to server .env and deploy config | https://app.clickup.com/t/869cfwrpu |
| Create second template (magazine or minimal) as proof of concept | https://app.clickup.com/t/869cfwrq9 |
