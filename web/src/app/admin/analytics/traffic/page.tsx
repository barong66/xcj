"use client";

import { useEffect, useState, useCallback } from "react";
import { getAdminSites, getTrafficStats } from "@/lib/admin-api";
import type { AdminSite, TrafficStatsRow, TrafficStatsResult } from "@/lib/admin-api";

// ─── Tab definitions ──────────────────────────────────────────────────────────

type TrafficTab = "overview" | "source" | "country" | "device";

const TABS: { key: TrafficTab; label: string; groupBy: string }[] = [
  { key: "overview", label: "Overview",   groupBy: "date" },
  { key: "source",   label: "By Source",  groupBy: "source" },
  { key: "country",  label: "By Country", groupBy: "country" },
  { key: "device",   label: "By Device",  groupBy: "device_type" },
];

const PERIOD_OPTIONS: { label: string; days: number }[] = [
  { label: "7d",  days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function fmtPct(n: number): string {
  return `${n.toFixed(2)}%`;
}

function dimLabel(tab: TrafficTab): string {
  switch (tab) {
    case "overview": return "Date";
    case "source":   return "Source";
    case "country":  return "Country";
    case "device":   return "Device";
  }
}

// ─── Summary card ─────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="bg-[#141414] border border-[#1e1e1e] rounded-lg p-4">
      <p className="text-[10px] text-[#6b6b6b] uppercase tracking-wide mb-2">{label}</p>
      <p className={`text-2xl font-bold ${accent ? "text-blue-400" : "text-white"}`}>{value}</p>
    </div>
  );
}

// ─── Table ────────────────────────────────────────────────────────────────────

interface Column {
  key: keyof TrafficStatsRow;
  label: string;
  fmt: (row: TrafficStatsRow) => string;
  align?: "left" | "right";
}

function buildColumns(tab: TrafficTab): Column[] {
  const dim: Column = {
    key: "dimension1",
    label: dimLabel(tab),
    fmt: (r) => r.dimension1 || "—",
    align: "left",
  };

  const sessions: Column = {
    key: "unique_sessions",
    label: "Sessions",
    fmt: (r) => fmtNum(Number(r.unique_sessions)),
    align: "right",
  };

  const impressions: Column = {
    key: "impressions",
    label: "Impressions",
    fmt: (r) => fmtNum(Number(r.impressions)),
    align: "right",
  };

  const clicks: Column = {
    key: "clicks",
    label: "Clicks",
    fmt: (r) => fmtNum(Number(r.clicks)),
    align: "right",
  };

  const ctr: Column = {
    key: "ctr",
    label: "CTR",
    fmt: (r) => fmtPct(r.ctr),
    align: "right",
  };

  const conversions: Column = {
    key: "conversions",
    label: "Conv.",
    fmt: (r) => fmtNum(Number(r.conversions)),
    align: "right",
  };

  switch (tab) {
    case "overview":
      return [dim, sessions, impressions, clicks, ctr, conversions];
    case "source":
      return [dim, sessions, impressions, clicks, ctr, conversions];
    case "country":
      return [dim, sessions, impressions, clicks, ctr];
    case "device":
      return [dim, sessions, impressions, clicks, ctr];
  }
}

function TrafficTable({
  rows,
  tab,
}: {
  rows: TrafficStatsRow[];
  tab: TrafficTab;
}) {
  const cols = buildColumns(tab);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#1e1e1e]">
            {cols.map((col) => (
              <th
                key={col.key}
                className={`py-2 px-3 text-[10px] font-medium text-[#6b6b6b] uppercase tracking-wide ${
                  col.align === "right" ? "text-right" : "text-left"
                }`}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={cols.length}
                className="py-8 text-center text-[#6b6b6b] text-xs"
              >
                No data for selected period
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr
                key={i}
                className="border-b border-[#1e1e1e] hover:bg-[#1a1a1a] transition-colors"
              >
                {cols.map((col) => (
                  <td
                    key={col.key}
                    className={`py-2 px-3 ${
                      col.align === "right"
                        ? "text-right text-[#a0a0a0]"
                        : "text-left text-white"
                    }`}
                  >
                    {col.fmt(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TrafficPage() {
  const [sites, setSites] = useState<AdminSite[]>([]);
  const [siteId, setSiteId] = useState<number | undefined>(undefined);
  const [days, setDays] = useState(7);
  const [tab, setTab] = useState<TrafficTab>("overview");
  const [result, setResult] = useState<TrafficStatsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load sites once on mount
  useEffect(() => {
    getAdminSites()
      .then((s) => {
        setSites(s);
        if (s.length > 0) setSiteId(s[0].id);
      })
      .catch(() => {});
  }, []);

  const loadData = useCallback(async () => {
    if (!siteId) return;
    try {
      setLoading(true);
      setError(null);
      const groupBy = TABS.find((t) => t.key === tab)?.groupBy ?? "date";
      const res = await getTrafficStats({
        group_by: groupBy,
        days,
        site_id: siteId,
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [siteId, days, tab]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const summary = result?.summary;
  const rows = result?.rows ?? [];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-white">Traffic</h1>
      </div>

      {/* Controls row */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        {/* Site selector */}
        <select
          value={siteId ?? ""}
          onChange={(e) => setSiteId(Number(e.target.value))}
          className="bg-[#141414] border border-[#1e1e1e] rounded-lg px-3 py-1.5 text-sm text-[#a0a0a0] focus:outline-none focus:border-[#333]"
        >
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.domain}
            </option>
          ))}
        </select>

        {/* Period toggle */}
        <div className="flex rounded-lg overflow-hidden border border-[#1e1e1e]">
          {PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.days}
              onClick={() => setDays(opt.days)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                days === opt.days
                  ? "bg-[#1e1e1e] text-white"
                  : "bg-[#141414] text-[#6b6b6b] hover:text-[#a0a0a0]"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {loading && (
          <span className="text-[10px] text-[#6b6b6b] ml-1">Loading...</span>
        )}
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Sessions"
          value={summary ? fmtNum(Number(summary.unique_sessions)) : "—"}
        />
        <StatCard
          label="Impressions"
          value={summary ? fmtNum(Number(summary.impressions)) : "—"}
        />
        <StatCard
          label="Clicks"
          value={summary ? fmtNum(Number(summary.clicks)) : "—"}
        />
        <StatCard
          label="CTR"
          value={summary ? fmtPct(summary.ctr) : "—"}
          accent
        />
      </div>

      {/* Tabs + table */}
      <div className="bg-[#141414] border border-[#1e1e1e] rounded-lg">
        {/* Tab bar */}
        <div className="flex border-b border-[#1e1e1e]">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-3 text-xs font-medium transition-colors border-b-2 ${
                tab === t.key
                  ? "text-white border-white"
                  : "text-[#6b6b6b] border-transparent hover:text-[#a0a0a0]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Table */}
        <TrafficTable rows={rows} tab={tab} />
      </div>
    </div>
  );
}
