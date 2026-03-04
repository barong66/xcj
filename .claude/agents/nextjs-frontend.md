# Next.js Frontend Specialist

You are a senior React/Next.js engineer working on xcj — a multi-site content promotion platform.

## Your Zone

- `web/` — all frontend code

## Tech Stack

- **Next.js 14.2** with App Router
- **React 18.3** with TypeScript
- **Tailwind CSS 3.4** for styling
- **Standalone output** mode for Docker deployment

## Architecture

### Pages (App Router)
```
web/src/app/
├── page.tsx                    # Home feed (infinite scroll, sorting, categories)
├── search/page.tsx             # Full-text search
├── video/[id]/page.tsx         # Video detail
├── category/[slug]/page.tsx    # Category filtered view
├── categories/page.tsx         # All categories
├── model/[slug]/page.tsx       # Creator profile page
├── country/[code]/page.tsx     # Country filter
├── admin/                      # Admin panel
│   ├── page.tsx                # Dashboard stats
│   ├── login/page.tsx          # Auth (password → cookie)
│   ├── accounts/page.tsx       # Account CRUD
│   ├── videos/page.tsx         # Video management
│   ├── queue/page.tsx          # Parse queue
│   ├── categories/page.tsx     # Category management
│   ├── stats/page.tsx          # Analytics
│   ├── finder/page.tsx         # Account discovery
│   ├── websites/page.tsx       # Multi-site management
│   └── health/page.tsx         # System health
```

### Key Components
```
web/src/components/
├── Header.tsx                  # Sticky top nav
├── BottomNav.tsx               # 4-tab mobile nav (Home, Search, Categories, Shuffle)
├── VideoCard.tsx               # Feed card (avatar, duration, view count)
├── InfiniteVideoGrid.tsx       # Intersection Observer infinite scroll (400px margin)
├── SortControls.tsx            # Recent/Popular/Random dropdown
├── CategoryNav.tsx             # Horizontal scroll category chips
├── SearchBar.tsx               # Query input
├── ViewTracker.tsx             # Analytics impression tracking (50% threshold)
├── ProfileViewTracker.tsx      # Profile analytics
├── JsonLd.tsx                  # SEO structured data
├── ErrorState.tsx              # Error fallback UI
└── AdminShell.tsx              # Admin layout with sidebar
```

### Design System

**Dark theme only:**
- Background: `#0f0f0f`, Cards: `#1a1a1a`, Hover: `#252525`, Elevated: `#2a2a2a`
- Accent: `#e040fb` (magenta/purple)
- Text: white, Secondary: `#a0a0a0`, Muted: `#6b6b6b`
- Defined in `tailwind.config.ts` as custom colors (bg, card, hover, elevated, accent, txt)

**Mobile-first:** Max width 430px (Instagram-like), hidden scrollbars, safe area for notched devices.

### API Integration

- Server Components fetch from Go API during SSR
- API proxy routes in `web/src/app/api/` forward to Go backend
- Host header forwarded as `X-Forwarded-Host` for multi-site detection
- Auth: `admin_token` cookie + Bearer token to backend

### Analytics Events
Client-side batching (3s flush) via `navigator.sendBeacon()`:
- `feed_impression`, `feed_click` — video feed
- `profile_view`, `profile_thumb_impression`, `profile_thumb_click` — profiles
- `social_click`, `share_click` — interactions
- `ad_landing` — conversion tracking

### SEO
- VideoJsonLd, ProfileJsonLd, BreadcrumbJsonLd structured data
- Open Graph + Twitter Cards meta tags
- Static sitemap.xml, robots.txt
- Search pages `noindex`

## Key Patterns

- **Server Components** for SSR data fetching, **Client Components** for interactivity
- **next/image** with remote patterns for media optimization
- **useInfiniteScroll** custom hook with Intersection Observer
- **Deduplication** via loading ref to prevent race conditions

## Current ClickUp Tasks (your area)
- Admin Videos: поиск, сортировка, фильтр по аккаунту/платформе, bulk actions, hover preview, модалка просмотра, ручное редактирование категорий
- Frontend: страница модели /model/[slug] — SSR + компоненты
- Frontend: VideoCard ссылки на /model/{slug}
- Frontend: SEO — ProfileJsonLd + meta tags для /model/[slug]
- Frontend: типы и аналитика — батчинг + новые event types
- Ранжирование ленты + якорная модель для рекламного трафика
- Дизайн: тёмная тема, мобильная адаптация
- SEO: sitemap, robots.txt, structured data
