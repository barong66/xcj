"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getDashboardSites, getQueueSummary } from "@/lib/admin-api";
import type { DashboardSite, QueueSummary } from "@/lib/admin-api";

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function SiteCard({ site, onClick }: { site: DashboardSite; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`text-left bg-[#141414] rounded-lg border p-4 hover:bg-[#1a1a1a] transition-colors w-full ${
        !site.is_active ? "border-red-500/30" : "border-[#1e1e1e]"
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

export default function AdminDashboardPage() {
  const router = useRouter();
  const [sites, setSites] = useState<DashboardSite[]>([]);
  const [queue, setQueue] = useState<QueueSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getDashboardSites(), getQueueSummary()])
      .then(([s, q]) => { setSites(s); setQueue(q); })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  const failedCount = queue?.failed ?? 0;

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-[#6b6b6b] text-sm">Loading...</div>;
  }

  if (error) {
    return <div className="p-4 text-red-400 text-sm">{error}</div>;
  }

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
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
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
