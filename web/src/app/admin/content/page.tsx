"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useState } from "react";
import {
  getAdminContent,
  selectFrame,
  deleteFrame,
  bulkDeleteFrames,
  type ContentVideo,
  type ContentFrame,
} from "@/lib/admin-api";
import { ToastProvider, useToast } from "../Toast";

// ─── Filter helpers ───────────────────────────────────────────────────────────

const ASPECT_RATIOS = ["9:16", "16:9", "4:5", "1:1"];

function aspectLabel(w: number | null, h: number | null): string {
  if (!w || !h || h === 0) return "";
  const r = w / h;
  if (r < 0.7) return "9:16";
  if (r > 1.5) return "16:9";
  if (r < 0.85) return "4:5";
  return "1:1";
}

// ─── Frame card ───────────────────────────────────────────────────────────────

function FrameCard({
  frame,
  isChecked,
  onToggleCheck,
  onSelect,
  onDelete,
}: {
  frame: ContentFrame;
  isChecked: boolean;
  onToggleCheck: (id: number) => void;
  onSelect: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  const score = frame.score;
  const scoreClass =
    score === null
      ? ""
      : score >= 7
      ? "bg-green-900/30 text-green-400 border border-green-800/40"
      : score >= 4
      ? "bg-black/70 text-neutral-500 border border-neutral-800"
      : "bg-black/50 text-neutral-700 border border-neutral-900";

  const opacity =
    score === null ? 1 : score >= 7 ? 1 : score >= 4 ? 0.9 : score >= 3 ? 0.55 : 0.35;

  return (
    <div
      className="relative flex-shrink-0 rounded-lg overflow-hidden cursor-pointer"
      style={{ width: 202, height: 360, opacity }}
      onClick={() => onToggleCheck(frame.id)}
    >
      {/* Thumbnail image */}
      <img
        src={frame.image_url}
        alt=""
        className="w-full h-full object-cover rounded-lg"
        style={{
          border: `3px solid ${
            frame.is_selected ? "#22c55e" : isChecked ? "#3b82f6" : "transparent"
          }`,
          borderRadius: 8,
        }}
        draggable={false}
      />

      {/* Top-left: star badge (selected) or bulk checkbox */}
      <div
        className="absolute top-2 left-2 z-10"
        onClick={(e) => {
          e.stopPropagation();
          if (!frame.is_selected) onToggleCheck(frame.id);
        }}
      >
        {frame.is_selected ? (
          <span className="bg-green-900/30 text-green-400 border border-green-700/50 rounded-full px-2.5 py-1 text-xs font-bold backdrop-blur-sm">
            ★ selected
          </span>
        ) : (
          <div
            className={`w-6 h-6 rounded-md flex items-center justify-center text-sm backdrop-blur-sm border ${
              isChecked
                ? "bg-blue-500/85 border-blue-400 text-white"
                : "bg-black/70 border-neutral-600"
            }`}
          >
            {isChecked ? "✓" : ""}
          </div>
        )}
      </div>

      {/* Top-right: score */}
      {score !== null && (
        <div
          className={`absolute top-2 right-2 z-10 rounded-full px-2.5 py-1 text-base font-extrabold backdrop-blur-sm pointer-events-none ${scoreClass}`}
        >
          {score.toFixed(1)}
        </div>
      )}
      {frame.score === null && (
        <div className="absolute top-2 right-2 z-10 rounded-full px-2.5 py-1 text-xs text-neutral-700 backdrop-blur-sm pointer-events-none">
          photo {frame.frame_index + 1}
        </div>
      )}

      {/* Bottom overlay: action buttons */}
      <div
        className="absolute bottom-0 left-0 right-0 flex gap-1.5 p-2 pt-10 z-10"
        style={{
          background:
            "linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.45) 55%, transparent 100%)",
          borderRadius: "0 0 6px 6px",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {!frame.is_selected && (
          <button
            className="flex-1 h-9 rounded-lg text-xs font-semibold text-green-400 border border-green-800/40 bg-green-900/25 backdrop-blur-sm hover:bg-green-900/40 transition-colors"
            onClick={() => onSelect(frame.id)}
          >
            ★ Select
          </button>
        )}
        <button
          className="flex-1 h-9 rounded-lg text-xs font-semibold text-red-400 border border-red-900/40 bg-red-950/20 backdrop-blur-sm hover:bg-red-950/40 transition-colors"
          onClick={() => onDelete(frame.id)}
        >
          🗑 Delete
        </button>
      </div>
    </div>
  );
}

// ─── Video card ───────────────────────────────────────────────────────────────

function VideoCard({
  video,
  isExpanded,
  checkedFrames,
  onToggleExpand,
  onToggleFrameCheck,
  onSelectAll,
  onSelectFrame,
  onDeleteFrame,
}: {
  video: ContentVideo;
  isExpanded: boolean;
  checkedFrames: Set<number>;
  onToggleExpand: (id: number) => void;
  onToggleFrameCheck: (id: number) => void;
  onSelectAll: (videoId: number) => void;
  onSelectFrame: (frameId: number) => void;
  onDeleteFrame: (frameId: number) => void;
}) {
  const ratio = aspectLabel(video.width, video.height);

  return (
    <div
      className={`rounded-xl overflow-hidden border ${
        isExpanded ? "border-green-900/50" : "border-[#1e1e1e]"
      } bg-[#111]`}
    >
      {/* Header */}
      <div className="px-4 py-3 flex items-start gap-3 border-b border-[#181818]">
        <div className="mt-0.5 w-14 h-8 bg-[#1e1e1e] rounded flex items-center justify-center text-[9px] text-neutral-600 flex-shrink-0">
          {video.media_type === "image" ? "🖼 img" : "▶ vid"}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-white text-sm mb-1.5">
            @{video.username}
          </div>
          <div className="flex flex-wrap gap-1.5 mb-1">
            <Badge color="purple">{video.platform}</Badge>
            {video.categories.map((c) => (
              <Badge key={c} color="green">{c}</Badge>
            ))}
            {video.sites.map((s) => (
              <Badge key={s} color="blue">{s}</Badge>
            ))}
            {ratio && <Badge color="yellow">{ratio}</Badge>}
          </div>
          <div className="text-xs text-neutral-700">
            {new Date(video.created_at).toLocaleDateString("en-US")} ·{" "}
            {video.view_count > 0
              ? `${(video.view_count / 1_000_000).toFixed(1)}M views · `
              : ""}
            ID {video.id}
          </div>
        </div>
        <div className="flex gap-2 flex-shrink-0 items-center">
          {isExpanded && (
            <button
              className="text-xs text-neutral-600 px-3 py-1.5 border border-[#1e1e1e] rounded-full hover:text-neutral-400 hover:border-[#333] transition-colors"
              onClick={() => onSelectAll(video.id)}
            >
              ☑ all
            </button>
          )}
          <button
            className={`text-xs px-3 py-1.5 border rounded-full transition-colors ${
              isExpanded
                ? "text-green-400 border-green-900/50 hover:border-green-700"
                : "text-neutral-600 border-[#1e1e1e] hover:text-neutral-400 hover:border-[#333]"
            }`}
            onClick={() => onToggleExpand(video.id)}
          >
            {isExpanded ? "✕ Collapse" : "✏ Edit"}
          </button>
        </div>
      </div>

      {/* Compact view: just the best frame */}
      {!isExpanded && (
        <div className="p-3">
          {video.frames.filter((f) => f.is_selected).map((frame) => (
            <div key={frame.id} className="relative inline-block rounded-lg overflow-hidden" style={{ width: 202, height: 360 }}>
              <img
                src={frame.image_url}
                alt=""
                className="w-full h-full object-cover rounded-lg"
                style={{ border: "3px solid #22c55e", borderRadius: 8 }}
              />
              {frame.score !== null && (
                <div className="absolute top-2 right-2 bg-green-900/30 text-green-400 border border-green-800/40 rounded-full px-2.5 py-1 text-base font-extrabold backdrop-blur-sm">
                  {frame.score.toFixed(1)}
                </div>
              )}
              <div className="absolute top-2 left-2">
                <span className="bg-green-900/30 text-green-400 border border-green-700/50 rounded-full px-2.5 py-1 text-xs font-bold backdrop-blur-sm">
                  ★ selected
                </span>
              </div>
            </div>
          ))}
          {video.frames.filter((f) => f.is_selected).length === 0 && (
            <div className="text-xs text-neutral-700 py-2">no selected frame</div>
          )}
        </div>
      )}

      {/* Expanded view: all frames */}
      {isExpanded && (
        <div
          className="flex gap-2.5 overflow-x-auto p-3"
          style={{ scrollbarWidth: "thin", scrollbarColor: "#222 transparent" }}
        >
          {video.frames.map((frame) => (
            <FrameCard
              key={frame.id}
              frame={frame}
              isChecked={checkedFrames.has(frame.id)}
              onToggleCheck={onToggleFrameCheck}
              onSelect={onSelectFrame}
              onDelete={onDeleteFrame}
            />
          ))}
          {video.frames.length === 0 && (
            <div className="text-xs text-neutral-700 py-4 px-2">no frames</div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Badge ────────────────────────────────────────────────────────────────────

function Badge({
  children,
  color,
}: {
  children: React.ReactNode;
  color: "purple" | "green" | "blue" | "yellow";
}) {
  const cls = {
    purple: "bg-purple-900/15 text-purple-400",
    green: "bg-green-900/15 text-green-400",
    blue: "bg-blue-900/15 text-blue-400",
    yellow: "bg-yellow-900/15 text-yellow-400",
  }[color];
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${cls}`}>
      {children}
    </span>
  );
}

// ─── Filter pill ──────────────────────────────────────────────────────────────

function FilterPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs border transition-colors ${
        active
          ? "bg-green-950/20 border-green-900/50 text-green-400"
          : "bg-[#161616] border-[#252525] text-neutral-500 hover:text-neutral-300 hover:border-[#333]"
      }`}
    >
      {label}
    </button>
  );
}

// ─── Main content component ───────────────────────────────────────────────────

function ContentPageContent() {
  const { toast } = useToast();

  // Filters
  const [source, setSource] = useState<string>("");
  const [accountId] = useState<number | undefined>(undefined);
  const [category] = useState<string>("");
  const [siteId] = useState<number | undefined>(undefined);
  const [aspectRatio, setAspectRatio] = useState<string>("");
  const [page, setPage] = useState(1);

  // Data
  const [data, setData] = useState<{ videos: ContentVideo[]; total: number } | null>(null);
  const [loading, setLoading] = useState(true);

  // UI state
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [checkedFrames, setCheckedFrames] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const result = await getAdminContent({
        source: source || undefined,
        account_id: accountId,
        category: category || undefined,
        site_id: siteId,
        aspect_ratio: aspectRatio || undefined,
        page,
        per_page: 20,
      });
      setData(result);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to load", "error");
    } finally {
      setLoading(false);
    }
  }, [source, accountId, category, siteId, aspectRatio, page, toast]);

  useEffect(() => {
    load();
  }, [load]);

  // Reset page on filter change
  const resetPage = () => setPage(1);

  // Expand/collapse accordion
  const handleToggleExpand = (videoId: number) => {
    setExpandedId((prev) => (prev === videoId ? null : videoId));
    setCheckedFrames(new Set());
  };

  // Toggle single frame check
  const handleToggleFrameCheck = (frameId: number) => {
    setCheckedFrames((prev) => {
      const next = new Set(prev);
      if (next.has(frameId)) next.delete(frameId);
      else next.add(frameId);
      return next;
    });
  };

  // Select all frames in a video
  const handleSelectAll = (videoId: number) => {
    const video = data?.videos.find((v) => v.id === videoId);
    if (!video) return;
    setCheckedFrames((prev) => {
      const next = new Set(prev);
      video.frames.forEach((f) => next.add(f.id));
      return next;
    });
  };

  // Select a frame as best
  const handleSelectFrame = async (frameId: number) => {
    try {
      await selectFrame(frameId);
      toast("Frame selected as best");
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Error", "error");
    }
  };

  // Delete single frame
  const handleDeleteFrame = async (frameId: number) => {
    if (!confirm("Delete this frame?")) return;
    try {
      await deleteFrame(frameId);
      toast("Frame deleted");
      setCheckedFrames((prev) => {
        const next = new Set(prev);
        next.delete(frameId);
        return next;
      });
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Delete error", "error");
    }
  };

  // Bulk delete
  const handleBulkDelete = async () => {
    const ids = Array.from(checkedFrames);
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} frames?`)) return;
    try {
      const result = await bulkDeleteFrames(ids);
      toast(`Deleted ${result.deleted} frames`);
      setCheckedFrames(new Set());
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Delete error", "error");
    }
  };

  const totalPages = data ? Math.ceil(data.total / 20) : 1;

  return (
    <div className="p-6 max-w-screen-2xl">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-2xl font-semibold text-white tracking-tight">Content</h1>
        <p className="text-xs text-neutral-600 mt-1">
          {data ? `${data.total} videos` : "Loading..."}
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center mb-5">
        {(["instagram", "twitter"] as const).map((s) => (
          <FilterPill
            key={s}
            label={s === "instagram" ? "📷 Instagram" : "🐦 Twitter"}
            active={source === s}
            onClick={() => {
              setSource(source === s ? "" : s);
              resetPage();
            }}
          />
        ))}
        <div className="w-px h-5 bg-[#1e1e1e] mx-1" />
        {ASPECT_RATIOS.map((ar) => (
          <FilterPill
            key={ar}
            label={ar}
            active={aspectRatio === ar}
            onClick={() => {
              setAspectRatio(aspectRatio === ar ? "" : ar);
              resetPage();
            }}
          />
        ))}
        {(source || aspectRatio || category) && (
          <>
            <div className="w-px h-5 bg-[#1e1e1e] mx-1" />
            <button
              className="text-xs text-neutral-700 hover:text-neutral-400 px-2 py-1.5 transition-colors"
              onClick={() => {
                setSource("");
                setAspectRatio("");
                resetPage();
              }}
            >
              ✕ clear
            </button>
          </>
        )}
      </div>

      {/* Bulk action bar */}
      {checkedFrames.size > 0 && (
        <div className="flex items-center gap-3 mb-4 px-4 py-2.5 bg-[#0d0d1f] border border-indigo-900/40 rounded-lg">
          <span className="text-indigo-400 text-xs font-medium">
            ✓ {checkedFrames.size} frames selected
          </span>
          <button
            onClick={handleBulkDelete}
            className="text-xs font-medium px-3 py-1.5 rounded-full bg-red-950/20 text-red-400 border border-red-900/30 hover:bg-red-950/40 transition-colors"
          >
            🗑 Delete selected
          </button>
          <button
            onClick={() => setCheckedFrames(new Set())}
            className="text-xs text-neutral-600 px-3 py-1.5 border border-[#1e1e1e] rounded-full hover:text-neutral-400 transition-colors"
          >
            Clear selection
          </button>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center h-64 text-neutral-600 text-sm">
          Loading...
        </div>
      ) : data && data.videos.length > 0 ? (
        <>
          <div className="flex flex-col gap-2.5">
            {data.videos.map((video) => (
              <VideoCard
                key={video.id}
                video={video}
                isExpanded={expandedId === video.id}
                checkedFrames={checkedFrames}
                onToggleExpand={handleToggleExpand}
                onToggleFrameCheck={handleToggleFrameCheck}
                onSelectAll={handleSelectAll}
                onSelectFrame={handleSelectFrame}
                onDeleteFrame={handleDeleteFrame}
              />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-6">
              <span className="text-xs text-neutral-600">
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                  className="px-3 py-1.5 text-xs rounded bg-[#1e1e1e] text-neutral-500 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  ← Back
                </button>
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage(page + 1)}
                  className="px-3 py-1.5 text-xs rounded bg-[#1e1e1e] text-neutral-500 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="bg-[#141414] rounded-xl border border-[#1e1e1e] p-8 text-center text-neutral-600 text-sm">
          Nothing found
        </div>
      )}
    </div>
  );
}

// ─── Page export ──────────────────────────────────────────────────────────────

export default function ContentPage() {
  return (
    <ToastProvider>
      <ContentPageContent />
    </ToastProvider>
  );
}
