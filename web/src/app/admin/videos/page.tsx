"use client";

import { useEffect, useState, useCallback } from "react";
import {
  getAdminVideos,
  getAdminCategories,
  deleteAdminVideo,
  recategorizeVideos,
} from "@/lib/admin-api";
import type { AdminVideoList, AdminCategory } from "@/lib/admin-api";
import { ToastProvider, useToast } from "../Toast";

function VideosContent() {
  const [data, setData] = useState<AdminVideoList | null>(null);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState("");
  const [uncategorized, setUncategorized] = useState(false);
  const [page, setPage] = useState(1);
  const { toast } = useToast();

  const loadVideos = useCallback(async () => {
    try {
      setLoading(true);
      const result = await getAdminVideos({
        category: category || undefined,
        uncategorized,
        page,
        per_page: 20,
      });
      setData(result);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to load videos", "error");
    } finally {
      setLoading(false);
    }
  }, [category, uncategorized, page, toast]);

  useEffect(() => {
    loadVideos();
  }, [loadVideos]);

  useEffect(() => {
    getAdminCategories().then(setCategories).catch(() => {});
  }, []);

  const handleDelete = async (id: number, title: string) => {
    const displayTitle = title.length > 50 ? title.slice(0, 50) + "..." : title;
    if (!confirm(`Delete video "${displayTitle}"?`)) return;
    try {
      await deleteAdminVideo(id);
      toast("Video deleted");
      loadVideos();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to delete video", "error");
    }
  };

  const handleRecategorize = async (ids: number[]) => {
    try {
      const result = await recategorizeVideos({ video_ids: ids });
      toast(`Queued ${result.updated} video(s) for recategorization`);
      loadVideos();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to recategorize", "error");
    }
  };

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const formatCount = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-white">Videos</h1>
        <span className="text-sm text-[#6b6b6b]">
          {data ? `${data.total.toLocaleString()} videos` : ""}
        </span>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <select
          value={category}
          onChange={(e) => { setCategory(e.target.value); setPage(1); }}
          className="px-3 py-2 text-sm rounded-lg bg-[#141414] border border-[#2a2a2a] text-white focus:outline-none focus:border-accent"
        >
          <option value="">All Categories</option>
          {categories.map((cat) => (
            <option key={cat.slug} value={cat.slug}>
              {cat.name} ({cat.video_count})
            </option>
          ))}
        </select>

        <label className="flex items-center gap-2 text-sm text-[#a0a0a0] cursor-pointer">
          <input
            type="checkbox"
            checked={uncategorized}
            onChange={(e) => { setUncategorized(e.target.checked); setPage(1); }}
            className="rounded bg-[#1a1a1a] border-[#2a2a2a] text-accent focus:ring-accent"
          />
          Uncategorized only
        </label>
      </div>

      {/* Video grid */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-[#6b6b6b] text-sm">Loading videos...</div>
        </div>
      ) : data && data.videos.length > 0 ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 mb-6 items-start">
            {data.videos.map((video) => {
              const isPortrait = video.height > video.width && video.width > 0;
              return (
              <div
                key={video.id}
                className="bg-[#141414] rounded-lg border border-[#1e1e1e] overflow-hidden group"
              >
                {/* Thumbnail */}
                <div className={`relative bg-[#0a0a0a] ${isPortrait ? "aspect-[9/16]" : "aspect-video"}`}>
                  {video.thumbnail_url ? (
                    <img
                      src={video.thumbnail_url}
                      alt={video.title}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[#3a3a3a]">
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <polygon points="23 7 16 12 23 17 23 7" />
                        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                      </svg>
                    </div>
                  )}
                  {/* Duration badge */}
                  <span className="absolute bottom-2 right-2 px-1.5 py-0.5 text-[10px] bg-black/80 text-white rounded">
                    {formatDuration(video.duration_sec)}
                  </span>
                  {/* Platform badge */}
                  <span
                    className={`absolute top-2 left-2 px-1.5 py-0.5 text-[10px] font-medium rounded capitalize ${
                      video.platform === "twitter"
                        ? "bg-blue-500/80 text-white"
                        : "bg-pink-500/80 text-white"
                    }`}
                  >
                    {video.platform}
                  </span>
                </div>

                {/* Info */}
                <div className="p-3">
                  <h3 className="text-sm text-white font-medium line-clamp-2 mb-1.5 leading-5">
                    {video.title || "(no title)"}
                  </h3>
                  <div className="text-xs text-[#6b6b6b] mb-2">
                    @{video.username}
                  </div>

                  {/* Categories */}
                  <div className="flex flex-wrap gap-1 mb-2">
                    {video.categories.length > 0 ? (
                      video.categories.slice(0, 3).map((cat) => (
                        <span
                          key={cat.slug}
                          className="px-1.5 py-0.5 text-[10px] rounded bg-accent/10 text-accent"
                        >
                          {cat.name}
                        </span>
                      ))
                    ) : (
                      <span className="px-1.5 py-0.5 text-[10px] rounded bg-yellow-500/10 text-yellow-400">
                        uncategorized
                      </span>
                    )}
                  </div>

                  {/* Stats */}
                  <div className="flex items-center gap-3 text-[10px] text-[#6b6b6b]">
                    <span>{formatCount(video.view_count)} views</span>
                    <span>{formatCount(video.click_count)} clicks</span>
                    <span>{new Date(video.created_at).toLocaleDateString()}</span>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[#1e1e1e]">
                    <button
                      onClick={() => handleRecategorize([video.id])}
                      className="flex-1 px-2 py-1.5 text-[11px] rounded bg-[#1e1e1e] text-[#a0a0a0] hover:text-white hover:bg-[#252525] transition-colors"
                    >
                      Recategorize
                    </button>
                    <button
                      onClick={() => handleDelete(video.id, video.title)}
                      className="flex-1 px-2 py-1.5 text-[11px] rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                    >
                      Delete
                    </button>
                    <a
                      href={video.original_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 rounded bg-[#1e1e1e] text-[#6b6b6b] hover:text-white hover:bg-[#252525] transition-colors"
                      title="Open original"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                    </a>
                  </div>
                </div>
              </div>
              );
            })}
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
          No videos found
        </div>
      )}
    </div>
  );
}

export default function VideosPage() {
  return (
    <ToastProvider>
      <VideosContent />
    </ToastProvider>
  );
}
