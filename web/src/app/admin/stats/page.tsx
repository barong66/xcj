"use client";

import { useEffect, useState, useCallback } from "react";
import { getVideoStats } from "@/lib/admin-api";
import type { VideoStatsList, VideoStatItem } from "@/lib/admin-api";
import { ToastProvider, useToast } from "../Toast";

type SortField = "impressions" | "clicks" | "ctr";
type SortDir = "asc" | "desc";

function StatsContent() {
  const [data, setData] = useState<VideoStatsList | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<SortField>("impressions");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const { toast } = useToast();

  const loadStats = useCallback(async () => {
    try {
      setLoading(true);
      const result = await getVideoStats({
        sort: sortBy,
        dir: sortDir,
        page,
        per_page: 24,
      });
      setData(result);
    } catch (err) {
      toast(
        err instanceof Error ? err.message : "Failed to load stats",
        "error"
      );
    } finally {
      setLoading(false);
    }
  }, [sortBy, sortDir, page, toast]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const handleSort = (field: SortField) => {
    if (field === sortBy) {
      setSortDir(sortDir === "desc" ? "asc" : "desc");
    } else {
      setSortBy(field);
      setSortDir("desc");
    }
    setPage(1);
  };

  const formatCount = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  };

  const formatDuration = (sec: number) => {
    if (!sec) return "0:00";
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Site Analytics</h1>
          <p className="text-sm text-[#6b6b6b] mt-1">
            Impressions, clicks &amp; CTR tracked on our site
          </p>
        </div>
        <button
          onClick={loadStats}
          className="text-sm text-[#a0a0a0] hover:text-white transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Summary cards — totals from ClickHouse */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-[#141414] rounded-lg border border-[#1e1e1e] p-4">
          <p className="text-xs text-[#6b6b6b] uppercase tracking-wide mb-1">
            Videos Tracked
          </p>
          <p className="text-2xl font-bold text-accent">
            {data?.total.toLocaleString() ?? "-"}
          </p>
        </div>
        <div className="bg-[#141414] rounded-lg border border-[#1e1e1e] p-4">
          <p className="text-xs text-[#6b6b6b] uppercase tracking-wide mb-1">
            Total Impressions
          </p>
          <p className="text-2xl font-bold text-blue-400">
            {formatCount(data?.total_impressions ?? 0)}
          </p>
          <p className="text-xs text-[#6b6b6b] mt-1">thumbnail views</p>
        </div>
        <div className="bg-[#141414] rounded-lg border border-[#1e1e1e] p-4">
          <p className="text-xs text-[#6b6b6b] uppercase tracking-wide mb-1">
            Total Clicks
          </p>
          <p className="text-2xl font-bold text-green-400">
            {formatCount(data?.total_clicks ?? 0)}
          </p>
          <p className="text-xs text-[#6b6b6b] mt-1">outbound clicks</p>
        </div>
        <div className="bg-[#141414] rounded-lg border border-[#1e1e1e] p-4">
          <p className="text-xs text-[#6b6b6b] uppercase tracking-wide mb-1">
            Overall CTR
          </p>
          <p className="text-2xl font-bold text-yellow-400">
            {(data?.total_ctr ?? 0).toFixed(2)}%
          </p>
          <p className="text-xs text-[#6b6b6b] mt-1">clicks / impressions</p>
        </div>
      </div>

      {/* Sort controls */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-sm text-[#6b6b6b]">Sort by:</span>
        {(
          [
            { key: "impressions", label: "Impressions" },
            { key: "clicks", label: "Clicks" },
            { key: "ctr", label: "CTR" },
          ] as { key: SortField; label: string }[]
        ).map((opt) => (
          <button
            key={opt.key}
            onClick={() => handleSort(opt.key)}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors flex items-center gap-1 ${
              sortBy === opt.key
                ? "bg-accent/10 text-accent"
                : "bg-[#1e1e1e] text-[#a0a0a0] hover:text-white"
            }`}
          >
            {opt.label}
            {sortBy === opt.key && (
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className={
                  sortDir === "asc" ? "rotate-180" : ""
                }
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            )}
          </button>
        ))}
      </div>

      {/* Video grid */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-[#6b6b6b] text-sm">Loading stats...</div>
        </div>
      ) : data && data.videos.length > 0 ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-6">
            {data.videos.map((video, idx) => (
              <VideoStatCard
                key={video.id}
                video={video}
                rank={(page - 1) * 24 + idx + 1}
                formatCount={formatCount}
                formatDuration={formatDuration}
              />
            ))}
          </div>

          {/* Pagination */}
          {data.total_pages > 1 && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-[#6b6b6b]">
                Page {data.page} of {data.total_pages}
              </span>
              <div className="flex gap-2">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                  className="px-3 py-1.5 text-sm rounded bg-[#1e1e1e] text-[#a0a0a0] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  Previous
                </button>
                <button
                  disabled={page >= data.total_pages}
                  onClick={() => setPage(page + 1)}
                  className="px-3 py-1.5 text-sm rounded bg-[#1e1e1e] text-[#a0a0a0] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="bg-[#141414] rounded-lg border border-[#1e1e1e] p-8 text-center text-[#6b6b6b]">
          <p className="mb-2">No site analytics data yet</p>
          <p className="text-xs">
            Browse the site to generate impression &amp; click events
          </p>
        </div>
      )}
    </div>
  );
}

function VideoStatCard({
  video,
  rank,
  formatCount,
  formatDuration,
}: {
  video: VideoStatItem;
  rank: number;
  formatCount: (n: number) => string;
  formatDuration: (sec: number) => string;
}) {
  return (
    <div className="bg-[#141414] rounded-lg border border-[#1e1e1e] overflow-hidden group hover:border-[#2a2a2a] transition-colors">
      {/* Thumbnail with overlay */}
      <div className="relative aspect-video bg-[#0a0a0a]">
        {video.thumbnail_url ? (
          <img
            src={video.thumbnail_url}
            alt={video.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[#3a3a3a]">
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <polygon points="23 7 16 12 23 17 23 7" />
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
          </div>
        )}

        {/* Rank badge */}
        <span className="absolute top-2 left-2 w-6 h-6 flex items-center justify-center text-[10px] font-bold bg-black/80 text-white rounded-full">
          {rank}
        </span>

        {/* Duration badge */}
        <span className="absolute bottom-2 right-2 px-1.5 py-0.5 text-[10px] bg-black/80 text-white rounded">
          {formatDuration(video.duration_sec)}
        </span>

        {/* Platform badge */}
        {video.platform && (
          <span
            className={`absolute top-2 right-2 px-1.5 py-0.5 text-[10px] font-medium rounded capitalize ${
              video.platform === "twitter"
                ? "bg-blue-500/80 text-white"
                : "bg-pink-500/80 text-white"
            }`}
          >
            {video.platform}
          </span>
        )}

        {/* Stats overlay on hover */}
        <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-lg font-bold text-white">
                {formatCount(video.impressions)}
              </p>
              <p className="text-[10px] text-[#a0a0a0] uppercase">Impressions</p>
            </div>
            <div>
              <p className="text-lg font-bold text-green-400">
                {formatCount(video.clicks)}
              </p>
              <p className="text-[10px] text-[#a0a0a0] uppercase">Clicks</p>
            </div>
            <div>
              <p className="text-lg font-bold text-yellow-400">
                {video.ctr.toFixed(1)}%
              </p>
              <p className="text-[10px] text-[#a0a0a0] uppercase">CTR</p>
            </div>
          </div>
        </div>
      </div>

      {/* Info */}
      <div className="p-3">
        <h3 className="text-sm text-white font-medium line-clamp-1 mb-1 leading-5">
          {video.title || "(no title)"}
        </h3>
        {video.username && (
          <div className="text-xs text-[#6b6b6b] mb-2">@{video.username}</div>
        )}

        {/* Stats bar */}
        <div className="flex items-center gap-3 text-[11px]">
          <span className="flex items-center gap-1 text-[#a0a0a0]">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            {formatCount(video.impressions)}
          </span>
          <span className="flex items-center gap-1 text-green-400/80">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
              <polyline points="10 17 15 12 10 7" />
              <line x1="15" y1="12" x2="3" y2="12" />
            </svg>
            {formatCount(video.clicks)}
          </span>
          <span className="flex items-center gap-1 text-yellow-400/80">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            {video.ctr.toFixed(1)}%
          </span>
        </div>

        {/* CTR progress bar */}
        <div className="mt-2 h-1 bg-[#1e1e1e] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${Math.min(video.ctr, 100)}%`,
              backgroundColor:
                video.ctr >= 5
                  ? "#13CE66"
                  : video.ctr >= 2
                  ? "#FFBA00"
                  : video.ctr > 0
                  ? "#FF4949"
                  : "#2a2a2a",
            }}
          />
        </div>
      </div>
    </div>
  );
}

export default function StatsPage() {
  return (
    <ToastProvider>
      <StatsContent />
    </ToastProvider>
  );
}
