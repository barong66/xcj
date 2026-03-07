"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  getVideoStats,
  getTrafficStats,
  getTrafficDimensions,
} from "@/lib/admin-api";
import type {
  VideoStatsList,
  VideoStatItem,
  TrafficStatsResult,
  TrafficStatsRow,
  TrafficDimensionValues,
} from "@/lib/admin-api";
import { ToastProvider, useToast } from "../Toast";

type StatsTab = "traffic" | "videos";

// ─── Dimension labels ─────────────────────────────────────────────────────────

const DIMENSION_LABELS: Record<string, string> = {
  date: "Date",
  source: "Source",
  referrer: "Referrer",
  country: "Country",
  device_type: "Device",
  os: "OS",
  browser: "Browser",
  event_type: "Event Type",
  utm_source: "UTM Source",
  utm_medium: "UTM Medium",
  utm_campaign: "UTM Campaign",
};

const METRIC_COLS: {
  key: keyof TrafficStatsRow;
  label: string;
  fmt: (v: number) => string;
}[] = [
  { key: "total_events", label: "Events", fmt: fmtNum },
  { key: "impressions", label: "Impressions", fmt: fmtNum },
  { key: "clicks", label: "Clicks", fmt: fmtNum },
  { key: "profile_views", label: "Profile Views", fmt: fmtNum },
  { key: "conversions", label: "Conversions", fmt: fmtNum },
  { key: "unique_sessions", label: "Sessions", fmt: fmtNum },
  { key: "ctr", label: "CTR %", fmt: fmtPct },
  { key: "conversion_rate", label: "Conv %", fmt: fmtPct },
];

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function fmtPct(n: number): string {
  return `${n.toFixed(2)}%`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Traffic Explorer
// ═══════════════════════════════════════════════════════════════════════════════

function TrafficExplorer() {
  const { toast } = useToast();

  const [groupBy, setGroupBy] = useState("date");
  const [groupBy2, setGroupBy2] = useState("");
  const [days, setDays] = useState(30);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sortBy, setSortBy] = useState("total_events");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [data, setData] = useState<TrafficStatsResult | null>(null);
  const [dimensions, setDimensions] = useState<TrafficDimensionValues[]>([]);
  const [loading, setLoading] = useState(true);
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [filterStep, setFilterStep] = useState<
    null | { dimension: string; values: string[] }
  >(null);
  const filterRef = useRef<HTMLDivElement>(null);

  // Load dimensions once
  useEffect(() => {
    getTrafficDimensions(days).then(setDimensions).catch(() => {});
  }, [days]);

  // Load data
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const result = await getTrafficStats({
        group_by: groupBy,
        group_by2: groupBy2 || undefined,
        days,
        sort: sortBy,
        dir: sortDir,
        ...filters,
      });
      setData(result);
    } catch (err) {
      toast(
        err instanceof Error ? err.message : "Failed to load traffic stats",
        "error"
      );
    } finally {
      setLoading(false);
    }
  }, [groupBy, groupBy2, days, sortBy, sortDir, filters, toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Close filter menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setShowFilterMenu(false);
        setFilterStep(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleSort = (col: string) => {
    if (col === sortBy) {
      setSortDir(sortDir === "desc" ? "asc" : "desc");
    } else {
      setSortBy(col);
      setSortDir("desc");
    }
  };

  const removeFilter = (key: string) => {
    setFilters((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const addFilter = (dim: string, val: string) => {
    setFilters((prev) => ({ ...prev, [dim]: val }));
    setShowFilterMenu(false);
    setFilterStep(null);
  };

  const summary = data?.summary;

  return (
    <div>
      {/* Controls bar */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        {/* Period */}
        <div className="flex items-center gap-1">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                days === d
                  ? "bg-accent/10 text-accent"
                  : "bg-[#1e1e1e] text-[#a0a0a0] hover:text-white"
              }`}
            >
              {d}d
            </button>
          ))}
        </div>

        <span className="text-[#2a2a2a]">|</span>

        {/* Group By */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#6b6b6b] uppercase">Group by</span>
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value)}
            className="bg-[#1a1a1a] border border-[#2a2a2a] text-white text-sm rounded-lg px-2 py-1.5 outline-none focus:border-accent/50"
          >
            {Object.entries(DIMENSION_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>

          <span className="text-xs text-[#6b6b6b]">+</span>
          <select
            value={groupBy2}
            onChange={(e) => setGroupBy2(e.target.value)}
            className="bg-[#1a1a1a] border border-[#2a2a2a] text-white text-sm rounded-lg px-2 py-1.5 outline-none focus:border-accent/50"
          >
            <option value="">(none)</option>
            {Object.entries(DIMENSION_LABELS)
              .filter(([k]) => k !== groupBy)
              .map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
          </select>
        </div>

        <span className="text-[#2a2a2a]">|</span>

        {/* Refresh */}
        <button
          onClick={loadData}
          className="text-sm text-[#a0a0a0] hover:text-white transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Active filters */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        {Object.entries(filters).map(([key, val]) => (
          <span
            key={key}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full bg-accent/10 text-accent"
          >
            {DIMENSION_LABELS[key] || key}: {val}
            <button
              onClick={() => removeFilter(key)}
              className="hover:text-white text-accent/60"
            >
              &times;
            </button>
          </span>
        ))}

        {/* Add filter button */}
        <div className="relative" ref={filterRef}>
          <button
            onClick={() => {
              setShowFilterMenu(!showFilterMenu);
              setFilterStep(null);
            }}
            className="px-2.5 py-1 text-xs rounded-full border border-dashed border-[#2a2a2a] text-[#6b6b6b] hover:text-white hover:border-[#4a4a4a] transition-colors"
          >
            + Filter
          </button>
          {showFilterMenu && (
            <div className="absolute top-8 left-0 z-50 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg shadow-xl min-w-[180px] max-h-[300px] overflow-y-auto">
              {filterStep === null ? (
                // Step 1: pick dimension
                <>
                  {dimensions
                    .filter(
                      (d) =>
                        !filters[d.dimension] && d.values.length > 0
                    )
                    .map((d) => (
                      <button
                        key={d.dimension}
                        onClick={() =>
                          setFilterStep({
                            dimension: d.dimension,
                            values: d.values,
                          })
                        }
                        className="block w-full text-left px-3 py-2 text-sm text-[#a0a0a0] hover:bg-[#252525] hover:text-white transition-colors"
                      >
                        {DIMENSION_LABELS[d.dimension] || d.dimension}
                      </button>
                    ))}
                  {dimensions.filter(
                    (d) => !filters[d.dimension] && d.values.length > 0
                  ).length === 0 && (
                    <p className="px-3 py-2 text-xs text-[#6b6b6b]">
                      No filters available
                    </p>
                  )}
                </>
              ) : (
                // Step 2: pick value
                <>
                  <div className="px-3 py-2 text-xs text-[#6b6b6b] border-b border-[#2a2a2a] flex items-center gap-2">
                    <button
                      onClick={() => setFilterStep(null)}
                      className="hover:text-white"
                    >
                      &larr;
                    </button>
                    {DIMENSION_LABELS[filterStep.dimension] ||
                      filterStep.dimension}
                  </div>
                  {filterStep.values.map((val) => (
                    <button
                      key={val}
                      onClick={() => addFilter(filterStep.dimension, val)}
                      className="block w-full text-left px-3 py-2 text-sm text-[#a0a0a0] hover:bg-[#252525] hover:text-white transition-colors truncate"
                    >
                      {val}
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
          <SummaryCard
            label="Total Events"
            value={fmtNum(summary.total_events)}
            color="text-white"
          />
          <SummaryCard
            label="Impressions"
            value={fmtNum(summary.impressions)}
            color="text-blue-400"
          />
          <SummaryCard
            label="Clicks"
            value={fmtNum(summary.clicks)}
            color="text-green-400"
          />
          <SummaryCard
            label="Sessions"
            value={fmtNum(summary.unique_sessions)}
            color="text-purple-400"
          />
          <SummaryCard
            label="CTR"
            value={fmtPct(summary.ctr)}
            color="text-yellow-400"
          />
          <SummaryCard
            label="Conv Rate"
            value={fmtPct(summary.conversion_rate)}
            color="text-orange-400"
          />
        </div>
      )}

      {/* Results table */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="text-[#6b6b6b] text-sm">Loading...</div>
        </div>
      ) : data && data.rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[#6b6b6b] text-xs uppercase border-b border-[#1e1e1e]">
                <SortableHeader
                  label={DIMENSION_LABELS[groupBy] || groupBy}
                  sortKey="dimension1"
                  currentSort={sortBy}
                  currentDir={sortDir}
                  onClick={handleSort}
                  align="left"
                />
                {groupBy2 && (
                  <SortableHeader
                    label={DIMENSION_LABELS[groupBy2] || groupBy2}
                    sortKey="dimension2"
                    currentSort={sortBy}
                    currentDir={sortDir}
                    onClick={handleSort}
                    align="left"
                  />
                )}
                {METRIC_COLS.map((col) => (
                  <SortableHeader
                    key={col.key}
                    label={col.label}
                    sortKey={col.key}
                    currentSort={sortBy}
                    currentDir={sortDir}
                    onClick={handleSort}
                    align="right"
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, i) => (
                <tr
                  key={i}
                  className="border-b border-[#1e1e1e] hover:bg-[#1a1a1a] transition-colors"
                >
                  <td className="py-2.5 pr-4 text-white font-medium whitespace-nowrap">
                    {row.dimension1 || "(empty)"}
                  </td>
                  {groupBy2 && (
                    <td className="py-2.5 pr-4 text-[#a0a0a0] whitespace-nowrap">
                      {row.dimension2 || "(empty)"}
                    </td>
                  )}
                  {METRIC_COLS.map((col) => (
                    <td
                      key={col.key}
                      className={`py-2.5 px-2 text-right whitespace-nowrap ${
                        col.key === "ctr" || col.key === "conversion_rate"
                          ? ctrColor(row[col.key] as number)
                          : "text-[#a0a0a0]"
                      }`}
                    >
                      {col.fmt(row[col.key] as number)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {data.rows.length >= 500 && (
            <p className="text-xs text-[#6b6b6b] mt-3">
              Results limited to 500 rows. Add filters to narrow down.
            </p>
          )}
        </div>
      ) : (
        <div className="bg-[#141414] rounded-lg border border-[#1e1e1e] p-8 text-center text-[#6b6b6b]">
          <p className="mb-2">No data for this period</p>
          <p className="text-xs">
            Try a different time period or remove filters
          </p>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="bg-[#141414] rounded-lg border border-[#1e1e1e] p-4">
      <p className="text-xs text-[#6b6b6b] uppercase tracking-wide mb-1">
        {label}
      </p>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

function SortableHeader({
  label,
  sortKey,
  currentSort,
  currentDir,
  onClick,
  align,
}: {
  label: string;
  sortKey: string;
  currentSort: string;
  currentDir: string;
  onClick: (key: string) => void;
  align: "left" | "right";
}) {
  const active = currentSort === sortKey;
  return (
    <th
      className={`py-2.5 px-2 font-medium cursor-pointer select-none hover:text-white transition-colors whitespace-nowrap ${
        align === "right" ? "text-right" : "text-left"
      } ${active ? "text-accent" : ""}`}
      onClick={() => onClick(sortKey)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active && (
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            className={currentDir === "asc" ? "rotate-180" : ""}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        )}
      </span>
    </th>
  );
}

function ctrColor(val: number): string {
  if (val >= 5) return "text-green-400";
  if (val >= 2) return "text-yellow-400";
  if (val > 0) return "text-orange-400";
  return "text-[#6b6b6b]";
}

// ═══════════════════════════════════════════════════════════════════════════════
// Video Stats (original content)
// ═══════════════════════════════════════════════════════════════════════════════

type VideoSortField = "impressions" | "clicks" | "ctr";
type SortDir = "asc" | "desc";

function VideoStatsContent() {
  const [data, setData] = useState<VideoStatsList | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<VideoSortField>("impressions");
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

  const handleSort = (field: VideoSortField) => {
    if (field === sortBy) {
      setSortDir(sortDir === "desc" ? "asc" : "desc");
    } else {
      setSortBy(field);
      setSortDir("desc");
    }
    setPage(1);
  };

  const formatCount = (n: number) => fmtNum(n);

  const formatDuration = (sec: number) => {
    if (!sec) return "0:00";
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div>
      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <SummaryCard
          label="Videos Tracked"
          value={data?.total.toLocaleString() ?? "-"}
          color="text-accent"
        />
        <SummaryCard
          label="Total Impressions"
          value={formatCount(data?.total_impressions ?? 0)}
          color="text-blue-400"
        />
        <SummaryCard
          label="Total Clicks"
          value={formatCount(data?.total_clicks ?? 0)}
          color="text-green-400"
        />
        <SummaryCard
          label="Overall CTR"
          value={`${(data?.total_ctr ?? 0).toFixed(2)}%`}
          color="text-yellow-400"
        />
      </div>

      {/* Sort controls */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-sm text-[#6b6b6b]">Sort by:</span>
        {(
          [
            { key: "impressions", label: "Impressions" },
            { key: "clicks", label: "Clicks" },
            { key: "ctr", label: "CTR" },
          ] as { key: VideoSortField; label: string }[]
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
                className={sortDir === "asc" ? "rotate-180" : ""}
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
        <span className="absolute top-2 left-2 w-6 h-6 flex items-center justify-center text-[10px] font-bold bg-black/80 text-white rounded-full">
          {rank}
        </span>
        <span className="absolute bottom-2 right-2 px-1.5 py-0.5 text-[10px] bg-black/80 text-white rounded">
          {formatDuration(video.duration_sec)}
        </span>
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
        <div className="absolute inset-0 bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-lg font-bold text-white">
                {formatCount(video.impressions)}
              </p>
              <p className="text-[10px] text-[#a0a0a0] uppercase">
                Impressions
              </p>
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
      <div className="p-3">
        <h3 className="text-sm text-white font-medium line-clamp-1 mb-1 leading-5">
          {video.title || "(no title)"}
        </h3>
        {video.username && (
          <div className="text-xs text-[#6b6b6b] mb-2">@{video.username}</div>
        )}
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

// ═══════════════════════════════════════════════════════════════════════════════
// Page with Tabs
// ═══════════════════════════════════════════════════════════════════════════════

function StatsPageContent() {
  const [tab, setTab] = useState<StatsTab>("traffic");

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Analytics</h1>
          <p className="text-sm text-[#6b6b6b] mt-1">
            Traffic conversion &amp; site performance
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-[#1e1e1e]">
        {(
          [
            { key: "traffic", label: "Traffic Explorer" },
            { key: "videos", label: "Video Stats" },
          ] as { key: StatsTab; label: string }[]
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t.key
                ? "border-accent text-accent"
                : "border-transparent text-[#6b6b6b] hover:text-white"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "traffic" ? <TrafficExplorer /> : <VideoStatsContent />}
    </div>
  );
}

export default function StatsPage() {
  return (
    <ToastProvider>
      <StatsPageContent />
    </ToastProvider>
  );
}
