# Admin Panel Redesign — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the admin panel with grouped sidebar navigation, per-site dashboard, tabbed analytics, and split Ads/Revenue sections.

**Architecture:** Primarily Next.js frontend changes in `web/src/app/admin/`. The AdminShell gets grouped navigation. New route directories are created for restructured sections. Minor Go API additions for per-site dashboard stats. Old routes get redirect pages. All existing API routes (`/api/v1/admin/*`) remain unchanged.

**Design spec:** `docs/superpowers/specs/2026-03-14-admin-redesign-design.md`

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind CSS, `web/src/lib/admin-api.ts`

---

## File Map

### New files (create)
- `web/src/app/admin/analytics/traffic/page.tsx` — Traffic section (replaces stats/page.tsx traffic tab)
- `web/src/app/admin/analytics/revenue/page.tsx` — Revenue section (new, extracts from promo/page.tsx)
- `web/src/app/admin/ads/promo/page.tsx` — Promo section (banner gallery + embed codes only)
- `web/src/app/admin/ads/sources/page.tsx` — Sources section (ad sources + CPA, from promo settings tab)
- `web/src/app/admin/analytics/layout.tsx` — layout wrapper for analytics group
- `web/src/app/admin/ads/layout.tsx` — layout wrapper for ads group

### Modified files
- `web/src/app/admin/AdminShell.tsx` — Add grouped nav with section headers, update href list
- `web/src/app/admin/page.tsx` — Dashboard: replace stat cards with site cards + alert bar
- `web/src/app/admin/queue/page.tsx` — Default to "failed" tab when `summary.failed > 0`
- `web/src/app/admin/websites/page.tsx` — Add traffic 7d column
- `web/src/app/admin/websites/[id]/page.tsx` — Add Content + Banners tabs alongside existing Settings
- `web/src/lib/admin-api.ts` — Add `getDashboardSites()`, `getSiteTrafficSummary()` functions + types

### Redirect/cleanup files (create then can delete old)
- `web/src/app/admin/stats/page.tsx` — Replace with redirect to `/admin/analytics/traffic`
- `web/src/app/admin/promo/page.tsx` — Replace with redirect to `/admin/ads/promo`
- `web/src/app/admin/content/page.tsx` — Replace with redirect to `/admin/accounts`

### Go API (one new endpoint)
- `api/internal/handlers/admin_dashboard.go` — `GET /api/v1/admin/dashboard/sites` returns per-site traffic + conversion summary
- `api/internal/router.go` — register new route

---

## Chunk 1: Navigation Shell

### Task 1: Update AdminShell with grouped navigation

**Files:**
- Modify: `web/src/app/admin/AdminShell.tsx`

The current `navItems` array is flat. We need to add group labels and update hrefs to match new routes.

- [ ] **Step 1: Update navItems in AdminShell.tsx**

Replace the `navItems` array and the nav rendering with grouped nav. The new `navGroups` structure:

```typescript
// In web/src/app/admin/AdminShell.tsx
// Replace the navItems array and nav rendering section

const navGroups = [
  {
    label: "OVERVIEW",
    items: [
      { label: "Dashboard", href: "/admin" },
    ],
  },
  {
    label: "ANALYTICS",
    items: [
      { label: "Traffic", href: "/admin/analytics/traffic" },
      { label: "Revenue", href: "/admin/analytics/revenue" },
    ],
  },
  {
    label: "CONTENT",
    items: [
      { label: "Accounts", href: "/admin/accounts" },
      { label: "Videos", href: "/admin/videos" },
      { label: "Queue", href: "/admin/queue" },
    ],
  },
  {
    label: "ADS",
    items: [
      { label: "Promo", href: "/admin/ads/promo" },
      { label: "Sources", href: "/admin/ads/sources" },
    ],
  },
  {
    label: "SITES",
    items: [
      { label: "Websites", href: "/admin/websites" },
      { label: "Categories", href: "/admin/categories" },
    ],
  },
  {
    label: "SYSTEM",
    items: [
      { label: "Health", href: "/admin/health" },
    ],
  },
];
```

Replace the `<nav>` section (lines ~221-243 in AdminShell.tsx) with:

```tsx
<nav className="flex-1 py-3 px-2 overflow-y-auto">
  {navGroups.map((group) => (
    <div key={group.label} className="mb-4">
      <div className="px-3 mb-1 text-[9px] font-semibold text-[#3a3a3a] uppercase tracking-widest">
        {group.label}
      </div>
      <div className="space-y-0.5">
        {group.items.map((item) => {
          const isActive =
            item.href === "/admin"
              ? pathname === "/admin"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setSidebarOpen(false)}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? "bg-accent/10 text-accent"
                  : "text-[#a0a0a0] hover:text-white hover:bg-[#1a1a1a]"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </div>
  ))}
</nav>
```

Note: Icons are removed for simplicity — grouped labels provide enough structure. Can be added back later.

- [ ] **Step 2: Update Breadcrumbs to handle new nested paths**

The current `Breadcrumbs` component splits on `/admin` which may misformat `/admin/analytics/traffic`. Verify it works — if not, update the segment parsing to capitalize properly.

- [ ] **Step 3: Verify in browser**

Run: `cd web && npm run dev`

Open http://localhost:3000/admin — sidebar should show 6 groups. All existing links (Accounts, Videos, Queue, etc.) should still work. New links (Traffic, Revenue, Promo, Sources) will 404 until those pages are created.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/admin/AdminShell.tsx
git commit -m "feat(admin): grouped sidebar navigation"
```

---

## Chunk 2: New Route Scaffolding

### Task 2: Create route directories and placeholder pages

**Files:**
- Create: `web/src/app/admin/analytics/traffic/page.tsx`
- Create: `web/src/app/admin/analytics/revenue/page.tsx`
- Create: `web/src/app/admin/ads/promo/page.tsx`
- Create: `web/src/app/admin/ads/sources/page.tsx`

Before migrating content, create minimal placeholder pages so nav links don't 404.

- [ ] **Step 1: Create placeholder pages**

```bash
mkdir -p web/src/app/admin/analytics/traffic
mkdir -p web/src/app/admin/analytics/revenue
mkdir -p web/src/app/admin/ads/promo
mkdir -p web/src/app/admin/ads/sources
```

Each placeholder (`page.tsx`):
```tsx
// web/src/app/admin/analytics/traffic/page.tsx
export default function TrafficPage() {
  return <div className="text-[#6b6b6b] text-sm p-4">Traffic — coming soon</div>;
}
```

Same pattern for revenue, ads/promo, ads/sources.

- [ ] **Step 2: Redirect old routes**

`web/src/app/admin/stats/page.tsx` — replace entire file:
```tsx
import { redirect } from "next/navigation";
export default function StatsRedirect() {
  redirect("/admin/analytics/traffic");
}
```

`web/src/app/admin/promo/page.tsx` — add redirect at top (keep old content commented for reference during migration):
```tsx
import { redirect } from "next/navigation";
export default function PromoRedirect() {
  redirect("/admin/ads/promo");
}
```

`web/src/app/admin/content/page.tsx` — replace:
```tsx
import { redirect } from "next/navigation";
export default function ContentRedirect() {
  redirect("/admin/accounts");
}
```

- [ ] **Step 3: Verify**

All nav links should resolve without 404. Old `/admin/stats` and `/admin/promo` should redirect.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/admin/analytics web/src/app/admin/ads \
  web/src/app/admin/stats/page.tsx web/src/app/admin/promo/page.tsx \
  web/src/app/admin/content/page.tsx
git commit -m "feat(admin): scaffold new route directories, redirect old routes"
```

---

## Chunk 3: Dashboard Redesign

### Task 3: Add per-site stats API endpoint (Go)

**Files:**
- Create: `api/internal/handlers/admin_dashboard.go`
- Modify: `api/internal/router.go` (or wherever admin routes are registered)

The dashboard site cards need per-site traffic summary (sessions 7d, conversions 7d, CTR). The existing `/api/v1/admin/stats` is global. We need a new endpoint.

- [ ] **Step 1: Locate router file**

```bash
grep -n "admin/stats\|RegisterAdmin\|adminRouter" api/internal/router.go | head -20
```

Find where admin routes are registered.

- [ ] **Step 2: Create handler**

```go
// api/internal/handlers/admin_dashboard.go
package handlers

import (
	"net/http"
	"github.com/go-chi/chi/v5"
)

// GET /api/v1/admin/dashboard/sites
// Returns per-site summary: site id, domain, name, is_active,
// sessions_7d, conversions_7d, ctr, video_count, category_count
func (h *Handler) AdminDashboardSites(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Fetch all sites
	sites, err := h.db.GetAdminSites(ctx)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	type SiteSummary struct {
		ID            int     `json:"id"`
		Domain        string  `json:"domain"`
		Name          string  `json:"name"`
		IsActive      bool    `json:"is_active"`
		VideoCount    int     `json:"video_count"`
		CategoryCount int     `json:"category_count"`
		Sessions7d    int64   `json:"sessions_7d"`
		Conversions7d int64   `json:"conversions_7d"`
		CTR           float64 `json:"ctr"`
	}

	result := make([]SiteSummary, 0, len(sites))
	for _, s := range sites {
		summary := SiteSummary{
			ID:            s.ID,
			Domain:        s.Domain,
			Name:          s.Name,
			IsActive:      s.IsActive,
			VideoCount:    s.VideoCount,
			CategoryCount: s.CategoryCount,
		}

		// Query ClickHouse for 7d traffic stats per site
		stats, err := h.chDB.GetSiteTrafficSummary(ctx, s.ID, 7)
		if err == nil {
			summary.Sessions7d = stats.Sessions
			summary.Conversions7d = stats.Conversions
			summary.CTR = stats.CTR
		}

		result = append(result, summary)
	}

	respondJSON(w, http.StatusOK, map[string]interface{}{
		"sites":  result,
		"status": "ok",
	})
}
```

- [ ] **Step 3: Add ClickHouse query**

In the ClickHouse DB layer (find existing file with CH queries, likely `api/internal/db/clickhouse.go` or similar):

```go
type SiteTrafficSummary struct {
	Sessions    int64
	Conversions int64
	CTR         float64
}

func (db *ClickHouseDB) GetSiteTrafficSummary(ctx context.Context, siteID int, days int) (SiteTrafficSummary, error) {
	query := `
		SELECT
			uniqExact(session_id) AS sessions,
			countIf(event_type = 'conversion') AS conversions,
			if(countIf(event_type = 'impression') > 0,
				countIf(event_type = 'click') * 100.0 / countIf(event_type = 'impression'),
				0) AS ctr
		FROM xcj_events
		WHERE site_id = ? AND timestamp >= now() - INTERVAL ? DAY
	`
	// Execute and scan...
}
```

Check the existing ClickHouse schema (look at `scripts/migrations/009_ch_xcj_events.sql` or similar) to confirm table/column names.

- [ ] **Step 4: Register route**

Add to admin router:
```go
r.Get("/dashboard/sites", h.AdminDashboardSites)
```

- [ ] **Step 5: Test the endpoint**

```bash
cd api && go build ./...
# Fix any compile errors

curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:8080/api/v1/admin/dashboard/sites
# Expected: {"sites": [...], "status": "ok"}
```

- [ ] **Step 6: Commit**

```bash
git add api/internal/handlers/admin_dashboard.go api/internal/
git commit -m "feat(api): add GET /api/v1/admin/dashboard/sites endpoint"
```

### Task 4: Add getDashboardSites to admin-api.ts

**Files:**
- Modify: `web/src/lib/admin-api.ts`

- [ ] **Step 1: Add type and function**

```typescript
// Add to web/src/lib/admin-api.ts

export interface DashboardSite {
  id: number;
  domain: string;
  name: string;
  is_active: boolean;
  video_count: number;
  category_count: number;
  sessions_7d: number;
  conversions_7d: number;
  ctr: number;
}

export async function getDashboardSites(): Promise<DashboardSite[]> {
  const result = await adminFetch<{ sites: DashboardSite[] }>("/dashboard/sites");
  return result.sites;
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/lib/admin-api.ts
git commit -m "feat(admin-api): add getDashboardSites type and function"
```

### Task 5: Redesign Dashboard page

**Files:**
- Modify: `web/src/app/admin/page.tsx`

Replace stat cards with site cards layout.

- [ ] **Step 1: Rewrite page.tsx**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getDashboardSites, getQueueSummary } from "@/lib/admin-api";
import type { DashboardSite, QueueSummary } from "@/lib/admin-api";
import { ToastProvider, useToast } from "./Toast";

function DashboardContent() {
  const router = useRouter();
  const [sites, setSites] = useState<DashboardSite[]>([]);
  const [queue, setQueue] = useState<QueueSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    Promise.all([getDashboardSites(), getQueueSummary()])
      .then(([s, q]) => { setSites(s); setQueue(q); })
      .catch((err) => toast(err instanceof Error ? err.message : "Failed to load", "error"))
      .finally(() => setLoading(false));
  }, [toast]);

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-[#6b6b6b] text-sm">Loading...</div>;
  }

  const failedCount = queue?.failed ?? 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-white">Dashboard</h1>
      </div>

      {/* Alert bar — only shown when queue has failures */}
      {failedCount > 0 && (
        <button
          onClick={() => router.push("/admin/queue")}
          className="w-full mb-5 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm text-left flex items-center gap-2 hover:bg-red-500/15 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          {failedCount} failed parse job{failedCount !== 1 ? "s" : ""} — click to review →
        </button>
      )}

      {/* Site cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
        {sites.map((site) => (
          <SiteCard
            key={site.id}
            site={site}
            onClick={() => router.push(`/admin/websites/${site.id}`)}
          />
        ))}
      </div>

      {/* Bottom widgets */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-[#141414] border border-[#1e1e1e] rounded-lg p-4">
          <p className="text-xs text-[#6b6b6b] uppercase tracking-wide mb-3">Parse Queue</p>
          <div className="flex gap-6">
            <div>
              <p className="text-xs text-[#6b6b6b]">Pending</p>
              <p className="text-lg font-bold text-white">{queue?.pending ?? 0}</p>
            </div>
            <div>
              <p className="text-xs text-[#6b6b6b]">Running</p>
              <p className="text-lg font-bold text-yellow-400">{queue?.running ?? 0}</p>
            </div>
            <div>
              <p className="text-xs text-[#6b6b6b]">Failed</p>
              <p className={`text-lg font-bold ${failedCount > 0 ? "text-red-400" : "text-[#6b6b6b]"}`}>{failedCount}</p>
            </div>
          </div>
        </div>
        <div className="bg-[#141414] border border-[#1e1e1e] rounded-lg p-4">
          <p className="text-xs text-[#6b6b6b] uppercase tracking-wide mb-3">Content</p>
          <div className="flex gap-6">
            <div>
              <p className="text-xs text-[#6b6b6b]">Sites</p>
              <p className="text-lg font-bold text-white">{sites.length}</p>
            </div>
            <div>
              <p className="text-xs text-[#6b6b6b]">Videos</p>
              <p className="text-lg font-bold text-white">
                {sites.reduce((s, x) => s + x.video_count, 0).toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SiteCard({ site, onClick }: { site: DashboardSite; onClick: () => void }) {
  const hasError = !site.is_active;
  return (
    <button
      onClick={onClick}
      className={`text-left bg-[#141414] rounded-lg border p-4 hover:bg-[#1a1a1a] transition-colors w-full ${
        hasError ? "border-red-500/30" : "border-[#1e1e1e]"
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-white font-mono">{site.domain}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
          site.is_active ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"
        }`}>
          {site.is_active ? "ACTIVE" : "INACTIVE"}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <p className="text-[10px] text-[#6b6b6b] mb-1">Traffic 7d</p>
          <p className="text-sm font-bold text-white">{fmtNum(site.sessions_7d)}</p>
        </div>
        <div>
          <p className="text-[10px] text-[#6b6b6b] mb-1">Conversions</p>
          <p className="text-sm font-bold text-blue-400">{site.conversions_7d.toLocaleString()}</p>
        </div>
        <div>
          <p className="text-[10px] text-[#6b6b6b] mb-1">CTR</p>
          <p className={`text-sm font-bold ${
            site.ctr >= 3 ? "text-green-400" : site.ctr >= 1 ? "text-yellow-400" : "text-[#6b6b6b]"
          }`}>{site.ctr.toFixed(1)}%</p>
        </div>
      </div>
    </button>
  );
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export default function AdminDashboardPage() {
  return (
    <ToastProvider>
      <DashboardContent />
    </ToastProvider>
  );
}
```

- [ ] **Step 2: Verify in browser**

`http://localhost:3000/admin` — should show site cards. Alert bar visible only if failed queue jobs exist.

- [ ] **Step 3: Commit**

```bash
git add web/src/app/admin/page.tsx
git commit -m "feat(admin): dashboard site cards with alert bar"
```

---

## Chunk 4: Analytics — Traffic

### Task 6: Build Analytics → Traffic page

**Files:**
- Modify: `web/src/app/admin/analytics/traffic/page.tsx` (replace placeholder)

This page replaces the existing `stats/page.tsx` Traffic Explorer tab. It adds a site selector and reorganizes into 4 tabs.

- [ ] **Step 1: Check if traffic stats API supports site filter**

```bash
grep -n "site_id\|siteId\|site_slug" web/src/lib/admin-api.ts
grep -rn "site_id\|siteId" api/internal/handlers/admin_stats.go 2>/dev/null || \
  grep -rn "site_id" api/internal/handlers/ | head -10
```

If the existing `getTrafficStats` doesn't support `site_id`, add it (see Step 2). If it does, skip to Step 3.

- [ ] **Step 2: Add site_id param to getTrafficStats (if missing)**

In `web/src/lib/admin-api.ts`, find `getTrafficStats` and add `site_id?: number` to its params. Verify the Go handler accepts this param and filters the ClickHouse query accordingly.

- [ ] **Step 3: Add getDashboardSites is already available — also add getAdminSites call for selector**

The site selector needs a list of sites. `getAdminSites()` already exists in admin-api.ts.

- [ ] **Step 4: Write the Traffic page**

```tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import { getAdminSites, getTrafficStats, getTrafficDimensions } from "@/lib/admin-api";
import type { AdminSite, TrafficStatsResult, TrafficDimensionValues } from "@/lib/admin-api";
import { ToastProvider, useToast } from "../../Toast";

type TrafficTab = "overview" | "source" | "country" | "device";

const TABS: { key: TrafficTab; label: string; groupBy: string }[] = [
  { key: "overview", label: "Overview", groupBy: "date" },
  { key: "source",   label: "By Source", groupBy: "source" },
  { key: "country",  label: "By Country", groupBy: "country" },
  { key: "device",   label: "By Device", groupBy: "device_type" },
];

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function TrafficContent() {
  const { toast } = useToast();
  const [sites, setSites] = useState<AdminSite[]>([]);
  const [siteId, setSiteId] = useState<number | undefined>(undefined);
  const [days, setDays] = useState(7);
  const [tab, setTab] = useState<TrafficTab>("overview");
  const [data, setData] = useState<TrafficStatsResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAdminSites()
      .then((s) => { setSites(s); if (s.length > 0) setSiteId(s[0].id); })
      .catch(() => {});
  }, []);

  const loadData = useCallback(async () => {
    if (!siteId) return;
    try {
      setLoading(true);
      const groupBy = TABS.find((t) => t.key === tab)?.groupBy ?? "date";
      const result = await getTrafficStats({ group_by: groupBy, days, site_id: siteId, sort: "total_events", dir: "desc" });
      setData(result);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to load", "error");
    } finally {
      setLoading(false);
    }
  }, [siteId, days, tab, toast]);

  useEffect(() => { loadData(); }, [loadData]);

  const summary = data?.summary;

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold text-white">Traffic</h1>
        <button onClick={loadData} className="text-sm text-[#a0a0a0] hover:text-white transition-colors">Refresh</button>
      </div>

      {/* Controls: site selector + period */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <select
          value={siteId ?? ""}
          onChange={(e) => setSiteId(Number(e.target.value))}
          className="px-3 py-2 text-sm rounded-lg bg-[#141414] border border-[#2a2a2a] text-white focus:outline-none focus:border-accent"
        >
          {sites.map((s) => <option key={s.id} value={s.id}>{s.domain}</option>)}
        </select>
        <div className="flex gap-1">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${days === d ? "bg-accent/10 text-accent" : "bg-[#1e1e1e] text-[#a0a0a0] hover:text-white"}`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          {[
            { label: "Sessions", value: fmtNum(summary.unique_sessions), color: "text-white" },
            { label: "Impressions", value: fmtNum(summary.impressions), color: "text-blue-400" },
            { label: "Clicks", value: fmtNum(summary.clicks), color: "text-green-400" },
            { label: "CTR", value: `${summary.ctr.toFixed(2)}%`, color: "text-yellow-400" },
          ].map((c) => (
            <div key={c.label} className="bg-[#141414] border border-[#1e1e1e] rounded-lg p-4">
              <p className="text-xs text-[#6b6b6b] uppercase tracking-wide mb-1">{c.label}</p>
              <p className={`text-2xl font-bold ${c.color}`}>{c.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-5 border-b border-[#1e1e1e]">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key ? "border-accent text-accent" : "border-transparent text-[#6b6b6b] hover:text-white"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center h-48 text-[#6b6b6b] text-sm">Loading...</div>
      ) : data && data.rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#1e1e1e] text-[#6b6b6b] text-xs uppercase">
                <th className="text-left py-2.5 pr-4 font-medium">{TABS.find((t) => t.key === tab)?.label}</th>
                <th className="text-right py-2.5 px-2 font-medium">Sessions</th>
                <th className="text-right py-2.5 px-2 font-medium">Impressions</th>
                <th className="text-right py-2.5 px-2 font-medium">Clicks</th>
                <th className="text-right py-2.5 px-2 font-medium">CTR</th>
                <th className="text-right py-2.5 px-2 font-medium">Conversions</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, i) => (
                <tr key={i} className="border-b border-[#1e1e1e] hover:bg-[#1a1a1a] transition-colors">
                  <td className="py-2.5 pr-4 text-white font-medium">{row.dimension1 || "(none)"}</td>
                  <td className="py-2.5 px-2 text-right text-[#a0a0a0]">{fmtNum(row.unique_sessions)}</td>
                  <td className="py-2.5 px-2 text-right text-[#a0a0a0]">{fmtNum(row.impressions)}</td>
                  <td className="py-2.5 px-2 text-right text-[#a0a0a0]">{fmtNum(row.clicks)}</td>
                  <td className={`py-2.5 px-2 text-right ${row.ctr >= 3 ? "text-green-400" : row.ctr >= 1 ? "text-yellow-400" : "text-[#6b6b6b]"}`}>
                    {row.ctr.toFixed(2)}%
                  </td>
                  <td className="py-2.5 px-2 text-right text-blue-400">{fmtNum(row.conversions)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-[#141414] border border-[#1e1e1e] rounded-lg p-8 text-center text-[#6b6b6b]">
          No data for this period
        </div>
      )}
    </div>
  );
}

export default function TrafficPage() {
  return <ToastProvider><TrafficContent /></ToastProvider>;
}
```

- [ ] **Step 5: Verify**

`http://localhost:3000/admin/analytics/traffic` — shows site selector, period toggle, 4 tabs, summary cards, table.

- [ ] **Step 6: Commit**

```bash
git add web/src/app/admin/analytics/traffic/page.tsx web/src/lib/admin-api.ts
git commit -m "feat(admin): Analytics Traffic page with site selector and tabs"
```

---

## Chunk 5: Analytics — Revenue

### Task 7: Build Analytics → Revenue page

**Files:**
- Modify: `web/src/app/admin/analytics/revenue/page.tsx` (replace placeholder)

Extracts content from `promo/page.tsx` StatisticsTab + moves postbacks here.

- [ ] **Step 1: Check existing functions**

The following functions already exist in `admin-api.ts` and can be reused:
- `getBannerFunnel(days)` → funnel by source
- `getPostbacks(days)` → recent postbacks list

- [ ] **Step 2: Write the Revenue page**

```tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import { getAdminSites, getBannerFunnel, getPostbacks } from "@/lib/admin-api";
import type { AdminSite, BannerFunnelStat, ConversionPostback } from "@/lib/admin-api";
import { ToastProvider, useToast } from "../../Toast";

function RevenueContent() {
  const { toast } = useToast();
  const [sites, setSites] = useState<AdminSite[]>([]);
  const [siteId, setSiteId] = useState<number | undefined>(undefined);
  const [days, setDays] = useState(30);
  const [funnel, setFunnel] = useState<BannerFunnelStat[]>([]);
  const [postbacks, setPostbacks] = useState<ConversionPostback[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAdminSites()
      .then((s) => { setSites(s); if (s.length > 0) setSiteId(s[0].id); })
      .catch(() => {});
  }, []);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [f, pb] = await Promise.all([getBannerFunnel(days), getPostbacks(30)]);
      setFunnel(f.funnel);
      setPostbacks(pb);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to load", "error");
    } finally {
      setLoading(false);
    }
  }, [days, toast]);

  useEffect(() => { loadData(); }, [loadData]);

  const totals = funnel.reduce(
    (acc, s) => ({
      impressions: acc.impressions + s.impressions,
      hovers: acc.hovers + s.hovers,
      clicks: acc.clicks + s.clicks,
      landings: acc.landings + s.landings,
      conversions: acc.conversions + s.conversions,
    }),
    { impressions: 0, hovers: 0, clicks: 0, landings: 0, conversions: 0 }
  );

  const totalCTR = totals.impressions > 0 ? ((totals.clicks / totals.impressions) * 100).toFixed(2) : "0";
  const totalConvRate = totals.clicks > 0 ? ((totals.conversions / totals.clicks) * 100).toFixed(2) : "0";

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold text-white">Revenue</h1>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 mb-5">
        <select
          value={siteId ?? ""}
          onChange={(e) => setSiteId(Number(e.target.value))}
          className="px-3 py-2 text-sm rounded-lg bg-[#141414] border border-[#2a2a2a] text-white focus:outline-none focus:border-accent"
        >
          {sites.map((s) => <option key={s.id} value={s.id}>{s.domain}</option>)}
        </select>
        <div className="flex gap-1">
          {[7, 30, 90].map((d) => (
            <button key={d} onClick={() => setDays(d)}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${days === d ? "bg-accent/10 text-accent" : "bg-[#1e1e1e] text-[#a0a0a0] hover:text-white"}`}
            >{d}d</button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48 text-[#6b6b6b] text-sm">Loading...</div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
            {[
              { label: "Impressions", value: totals.impressions },
              { label: "Hovers",      value: totals.hovers },
              { label: "Clicks",      value: totals.clicks },
              { label: "Landings",    value: totals.landings },
              { label: "Conversions", value: totals.conversions },
              { label: "CTR",         value: `${totalCTR}%` },
              { label: "Conv Rate",   value: `${totalConvRate}%` },
            ].map((item) => (
              <div key={item.label} className="bg-[#141414] border border-[#1e1e1e] rounded-lg p-3">
                <div className="text-[10px] text-[#6b6b6b] mb-1">{item.label}</div>
                <div className="text-lg font-bold text-white">
                  {typeof item.value === "number" ? item.value.toLocaleString() : item.value}
                </div>
              </div>
            ))}
          </div>

          {/* Funnel by source */}
          {funnel.length > 0 && (
            <div className="bg-[#141414] border border-[#1e1e1e] rounded-lg overflow-hidden mb-6">
              <div className="px-4 py-3 border-b border-[#1e1e1e]">
                <h3 className="text-sm font-semibold text-white">By Source</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[#6b6b6b] text-xs border-b border-[#1e1e1e]">
                      <th className="text-left px-4 py-2 font-medium">Source</th>
                      <th className="text-right px-4 py-2 font-medium">Impr.</th>
                      <th className="text-right px-4 py-2 font-medium">Clicks</th>
                      <th className="text-right px-4 py-2 font-medium">Landings</th>
                      <th className="text-right px-4 py-2 font-medium">Conv.</th>
                      <th className="text-right px-4 py-2 font-medium">CTR</th>
                      <th className="text-right px-4 py-2 font-medium">Conv%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {funnel.map((row) => (
                      <tr key={row.source} className="border-b border-[#1e1e1e] last:border-0 hover:bg-[#1a1a1a] transition-colors">
                        <td className="px-4 py-2.5 text-white font-medium">{row.source}</td>
                        <td className="px-4 py-2.5 text-right text-[#a0a0a0]">{row.impressions.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-right text-[#a0a0a0]">{row.clicks.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-right text-[#a0a0a0]">{row.landings.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-right text-white font-medium">{row.conversions.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-right text-[#a0a0a0]">{row.ctr}%</td>
                        <td className="px-4 py-2.5 text-right text-[#a0a0a0]">{row.conv_rate}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Recent postbacks */}
          {postbacks.length > 0 && (
            <div className="bg-[#141414] border border-[#1e1e1e] rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-[#1e1e1e]">
                <h3 className="text-sm font-semibold text-white">Recent Postbacks</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[#6b6b6b] text-xs border-b border-[#1e1e1e]">
                      <th className="text-left px-4 py-2 font-medium">Source</th>
                      <th className="text-left px-4 py-2 font-medium">Click ID</th>
                      <th className="text-left px-4 py-2 font-medium">Event</th>
                      <th className="text-left px-4 py-2 font-medium">Status</th>
                      <th className="text-left px-4 py-2 font-medium">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {postbacks.map((pb) => (
                      <tr key={pb.id} className="border-b border-[#1e1e1e] last:border-0 hover:bg-[#1a1a1a] transition-colors">
                        <td className="px-4 py-2 text-white">{pb.ad_source_name}</td>
                        <td className="px-4 py-2 text-[#a0a0a0] font-mono text-xs truncate max-w-[140px]">{pb.click_id}</td>
                        <td className="px-4 py-2 text-[#a0a0a0]">{pb.event_type}</td>
                        <td className="px-4 py-2">
                          <span className={`inline-block px-1.5 py-0.5 text-[10px] rounded ${
                            pb.status === "sent" ? "bg-green-900/50 text-green-400" :
                            pb.status === "failed" ? "bg-red-900/50 text-red-400" :
                            "bg-yellow-900/50 text-yellow-400"
                          }`}>{pb.status}</span>
                        </td>
                        <td className="px-4 py-2 text-[#6b6b6b] text-xs">
                          {new Date(pb.created_at).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function RevenuePage() {
  return <ToastProvider><RevenueContent /></ToastProvider>;
}
```

- [ ] **Step 3: Verify**

`http://localhost:3000/admin/analytics/revenue` — funnel summary cards, by-source table, postbacks table.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/admin/analytics/revenue/page.tsx
git commit -m "feat(admin): Analytics Revenue page with funnel and postbacks"
```

---

## Chunk 6: Ads — Promo and Sources

### Task 8: Build Ads → Promo page (banner gallery + embed codes)

**Files:**
- Modify: `web/src/app/admin/ads/promo/page.tsx` (replace placeholder)

Extract only the BannersTab content from old `promo/page.tsx`.

- [ ] **Step 1: Copy BannersTab content**

The content of `BannersTab` and `EmbedCodeSection` from `web/src/app/admin/promo/page.tsx` (lines ~36-478) can be moved into `ads/promo/page.tsx` mostly as-is. The import paths need to change from `"../Toast"` to `"../../Toast"`.

Key changes:
- Rename component: `PromoContent` wraps just banners (no tabs)
- Adjust import: `from "../../Toast"` (two levels up now)
- Remove the tab switcher

- [ ] **Step 2: Import path adjustment**

```bash
# Check and update all relative imports in the new file
sed 's|"../Toast"|"../../Toast"|g' web/src/app/admin/ads/promo/page.tsx
```

- [ ] **Step 3: Verify**

`http://localhost:3000/admin/ads/promo` — banner sizes, embed codes, banner gallery.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/admin/ads/promo/page.tsx
git commit -m "feat(admin): Ads Promo page (banner gallery + embed codes)"
```

### Task 9: Build Ads → Sources page

**Files:**
- Modify: `web/src/app/admin/ads/sources/page.tsx` (replace placeholder)

Extract `SettingsTab` content from old `promo/page.tsx`.

- [ ] **Step 1: Copy SettingsTab content**

Extract the `SettingsTab` component (lines ~681-840 in old promo/page.tsx). Rename to `SourcesContent`. Adjust import: `from "../../Toast"`.

- [ ] **Step 2: Verify**

`http://localhost:3000/admin/ads/sources` — ad sources list, add source form, conversion tracking info.

- [ ] **Step 3: Commit**

```bash
git add web/src/app/admin/ads/sources/page.tsx
git commit -m "feat(admin): Ads Sources page (ad sources + postback config)"
```

---

## Chunk 7: Queue and Sites Improvements

### Task 10: Queue — default to Failed tab when errors exist

**Files:**
- Modify: `web/src/app/admin/queue/page.tsx`

Small change: initialize `statusFilter` to `"failed"` when `summary.failed > 0`. Since summary loads asynchronously, this requires a `useEffect` that fires after summary loads.

- [ ] **Step 1: Add auto-select Failed tab logic**

In `QueueContent`, after `summary` loads, if the current filter is `""` (All) and `summary.failed > 0`, switch to `"failed"`:

```typescript
// Add after setSummary(sum) in loadQueue:
if (sum.failed > 0 && statusFilter === "") {
  setStatusFilter("failed");
}
```

Or more cleanly, initialize based on summary before data load by checking on mount:

```typescript
const [statusFilter, setStatusFilter] = useState("");
const [initialized, setInitialized] = useState(false);

// In loadQueue, after getting summary:
if (!initialized) {
  setInitialized(true);
  if (sum.failed > 0) setStatusFilter("failed");
}
```

- [ ] **Step 2: Verify**

When there are failed jobs, opening `/admin/queue` should default to showing the Failed tab. When no failures, defaults to All.

- [ ] **Step 3: Commit**

```bash
git add web/src/app/admin/queue/page.tsx
git commit -m "feat(admin): queue defaults to Failed tab when errors exist"
```

### Task 11: Websites list — add traffic 7d column

**Files:**
- Modify: `web/src/app/admin/websites/page.tsx`
- Modify: `web/src/lib/admin-api.ts` (add traffic_7d to AdminSite type if needed)

- [ ] **Step 1: Check if AdminSite has traffic data**

`AdminSite` interface currently has `video_count` and `category_count` but not traffic. The dashboard uses a separate endpoint. Options:
- Option A: Add `sessions_7d` to the existing `GET /api/v1/admin/sites` endpoint response
- Option B: Fetch dashboard sites data and join on the websites page

**Recommend Option A** — simpler. Add `sessions_7d int` to Go's site response struct, populated from ClickHouse with a single query.

- [ ] **Step 2: Update Go API site handler**

Find `admin_sites.go` (or equivalent) in `api/internal/handlers/`. Add ClickHouse lookup for sessions_7d to the site list endpoint.

- [ ] **Step 3: Update AdminSite type in admin-api.ts**

```typescript
export interface AdminSite {
  // ... existing fields ...
  sessions_7d?: number;  // add
}
```

- [ ] **Step 4: Add column to websites table**

In `websites/page.tsx`, add after the Categories column:
```tsx
<th className="text-right px-4 py-3 text-[#6b6b6b] font-medium">Traffic 7d</th>
// ...
<td className="px-4 py-3 text-right text-[#a0a0a0]">
  {site.sessions_7d != null ? fmtNum(site.sessions_7d) : "—"}
</td>
```

Add `fmtNum` helper at top of file.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/admin/websites/page.tsx web/src/lib/admin-api.ts api/internal/handlers/
git commit -m "feat(admin): websites list with traffic 7d column"
```

### Task 12: Website detail page — add Content and Banners tabs

**Files:**
- Modify: `web/src/app/admin/websites/[id]/page.tsx`

Currently the site detail page only has settings. Add Content tab (enabled categories + linked accounts) and Banners tab (active banner sizes + embed code for this site).

- [ ] **Step 1: Add tab structure**

```typescript
type SiteTab = "settings" | "content" | "banners";
```

- [ ] **Step 2: Settings tab** — existing content, unchanged

- [ ] **Step 3: Content tab** — show categories list with enable/disable toggle per site (needs API: `GET /api/v1/admin/sites/:id/categories`). If this endpoint doesn't exist, display linked accounts (which do exist via `getAdminAccounts`) as a fallback, and file a TODO for categories.

- [ ] **Step 4: Banners tab** — show active banner sizes for this site. Use existing `getBannerSizes()` and render an embed code snippet pre-filtered. No new API needed.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/admin/websites/[id]/page.tsx
git commit -m "feat(admin): website detail page with Content and Banners tabs"
```

---

## Chunk 8: Final Cleanup

### Task 13: Remove empty Content page, clean old promo page

- [ ] **Step 1: Verify all old routes redirect correctly**

```bash
# These should all redirect:
curl -I http://localhost:3000/admin/stats    # → /admin/analytics/traffic
curl -I http://localhost:3000/admin/promo    # → /admin/ads/promo
curl -I http://localhost:3000/admin/content  # → /admin/accounts
```

- [ ] **Step 2: Remove Finder from nav (already done in Chunk 1)**

The Finder page (`/admin/finder`) is no longer in the sidebar. The functionality is already in Accounts → Bulk Import. The Finder route file can stay as an unlisted page or be removed.

- [ ] **Step 3: Smoke test all nav items**

Run through every sidebar link and verify each page loads:
- `/admin` ✓
- `/admin/analytics/traffic` ✓
- `/admin/analytics/revenue` ✓
- `/admin/accounts` ✓
- `/admin/videos` ✓
- `/admin/queue` ✓
- `/admin/ads/promo` ✓
- `/admin/ads/sources` ✓
- `/admin/websites` ✓
- `/admin/categories` ✓
- `/admin/health` ✓

- [ ] **Step 4: Build check**

```bash
cd web && npm run build
# Fix any TypeScript errors before committing
```

- [ ] **Step 5: Final commit**

```bash
git add .
git commit -m "feat(admin): complete admin panel redesign

- Grouped sidebar navigation (6 groups)
- Dashboard with per-site cards and error alert bar
- Analytics: Traffic (tabs + site selector) and Revenue (funnel + postbacks)
- Ads: Promo (banners) and Sources (ad network config)
- Queue: auto-focus Failed tab when errors exist
- Websites: traffic column + detail page with Content/Banners tabs
- Redirects from old routes (/admin/stats, /admin/promo, /admin/content)"
```

---

## Implementation Notes

### API gaps to resolve early
Before starting Chunk 3, verify:
1. Does `GET /api/v1/admin/stats/traffic` (or equivalent) accept `site_id` filter? If not, add it.
2. Does `GET /api/v1/admin/sites` return any traffic stats? If not, add `sessions_7d` to the response.

Check with: `grep -rn "site_id" api/internal/handlers/` to see what's supported.

### Testing approach
The web app has no test infrastructure configured (`npm test` is noted as "when configured" in CLAUDE.md). Focus on:
- Manual smoke testing in browser after each task
- `npm run build` to catch TypeScript errors
- Go unit tests where applicable: `cd api && go test ./...`

### Working directory
All `web/` commands: run from `web/` directory.
All `api/` commands: run from `api/` directory.
All `git` commands: run from repo root.
