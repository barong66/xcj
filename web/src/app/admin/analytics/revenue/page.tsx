"use client";

import { useEffect, useState, useCallback } from "react";
import {
  getBannerFunnel,
  getPostbacks,
} from "@/lib/admin-api";
import type { BannerFunnelStat, ConversionPostback } from "@/lib/admin-api";

const PERIODS = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
] as const;

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

function pct(n: number): string {
  return (n * 100).toFixed(2) + "%";
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "sent"
      ? "bg-green-900/50 text-green-400"
      : status === "failed"
        ? "bg-red-900/50 text-red-400"
        : "bg-yellow-900/50 text-yellow-400";
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}

interface SummaryTotals {
  impressions: number;
  hovers: number;
  clicks: number;
  landings: number;
  conversions: number;
  ctr: number;
  conv_rate: number;
}

function computeTotals(funnel: BannerFunnelStat[]): SummaryTotals {
  if (funnel.length === 0) {
    return {
      impressions: 0,
      hovers: 0,
      clicks: 0,
      landings: 0,
      conversions: 0,
      ctr: 0,
      conv_rate: 0,
    };
  }
  const impressions = funnel.reduce((s, r) => s + r.impressions, 0);
  const hovers = funnel.reduce((s, r) => s + r.hovers, 0);
  const clicks = funnel.reduce((s, r) => s + r.clicks, 0);
  const landings = funnel.reduce((s, r) => s + r.landings, 0);
  const conversions = funnel.reduce((s, r) => s + r.conversions, 0);
  const ctr = impressions > 0 ? clicks / impressions : 0;
  const conv_rate = clicks > 0 ? conversions / clicks : 0;
  return { impressions, hovers, clicks, landings, conversions, ctr, conv_rate };
}

export default function RevenuePage() {
  const [days, setDays] = useState<number>(7);
  const [funnel, setFunnel] = useState<BannerFunnelStat[]>([]);
  const [postbacks, setPostbacks] = useState<ConversionPostback[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [funnelRes, postbacksRes] = await Promise.all([
        getBannerFunnel(days),
        getPostbacks(50),
      ]);
      setFunnel(funnelRes.funnel ?? []);
      setPostbacks(postbacksRes ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    load();
  }, [load]);

  const totals = computeTotals(funnel);

  const summaryCards = [
    { label: "Impressions", value: fmt(totals.impressions) },
    { label: "Hovers", value: fmt(totals.hovers) },
    { label: "Clicks", value: fmt(totals.clicks) },
    { label: "Landings", value: fmt(totals.landings) },
    { label: "Conversions", value: fmt(totals.conversions) },
    { label: "CTR", value: pct(totals.ctr) },
    { label: "Conv Rate", value: pct(totals.conv_rate) },
  ];

  return (
    <div className="space-y-6">
      {/* Header + controls */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs text-[#6b6b6b] uppercase tracking-wide mb-1">
            Analytics
          </p>
          <h1 className="text-white text-xl font-semibold">Revenue</h1>
        </div>

        {/* TODO: Site selector - getBannerFunnel/getPostbacks don't yet support site_id filter.
            Add site_id support to the banner funnel ClickHouse query when needed. */}
        <div className="flex items-center gap-2">
          {PERIODS.map((p) => (
            <button
              key={p.days}
              onClick={() => setDays(p.days)}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                days === p.days
                  ? "bg-accent/10 text-accent"
                  : "bg-[#1e1e1e] text-[#a0a0a0] hover:text-white"
              }`}
            >
              {p.label}
            </button>
          ))}
          <button
            onClick={load}
            disabled={loading}
            className="ml-1 px-3 py-1.5 rounded text-xs font-medium bg-[#1e1e1e] text-[#a0a0a0] hover:text-white disabled:opacity-40 transition-colors"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/20 border border-red-800/40 rounded-lg px-4 py-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Summary cards */}
      <section>
        <p className="text-xs text-[#6b6b6b] uppercase tracking-wide mb-3">
          Summary — last {days} days
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {summaryCards.map((card) => (
            <div
              key={card.label}
              className="bg-[#141414] border border-[#1e1e1e] rounded-lg p-4"
            >
              <p className="text-xs text-[#6b6b6b] mb-1">{card.label}</p>
              <p className="text-white text-xl font-semibold">{card.value}</p>
            </div>
          ))}
        </div>
      </section>

      {/* By Source table */}
      <section>
        <p className="text-xs text-[#6b6b6b] uppercase tracking-wide mb-3">
          By Source
        </p>
        <div className="bg-[#141414] border border-[#1e1e1e] rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#1e1e1e]">
                {[
                  "Source",
                  "Impressions",
                  "Hovers",
                  "Clicks",
                  "Landings",
                  "Conversions",
                  "CTR",
                  "Conv%",
                ].map((h) => (
                  <th
                    key={h}
                    className="text-[#6b6b6b] text-xs font-medium text-left px-4 py-3"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {funnel.length === 0 && !loading ? (
                <tr>
                  <td
                    colSpan={8}
                    className="text-center text-[#6b6b6b] text-xs py-8"
                  >
                    No data for this period
                  </td>
                </tr>
              ) : (
                funnel.map((row) => (
                  <tr
                    key={row.source}
                    className="border-b border-[#1e1e1e] last:border-0 hover:bg-[#1a1a1a] transition-colors"
                  >
                    <td className="px-4 py-3 text-white font-medium">
                      {row.source || "(direct)"}
                    </td>
                    <td className="px-4 py-3 text-[#a0a0a0]">
                      {fmt(row.impressions)}
                    </td>
                    <td className="px-4 py-3 text-[#a0a0a0]">
                      {fmt(row.hovers)}
                    </td>
                    <td className="px-4 py-3 text-[#a0a0a0]">
                      {fmt(row.clicks)}
                    </td>
                    <td className="px-4 py-3 text-[#a0a0a0]">
                      {fmt(row.landings)}
                    </td>
                    <td className="px-4 py-3 text-[#a0a0a0]">
                      {fmt(row.conversions)}
                    </td>
                    <td className="px-4 py-3 text-[#a0a0a0]">
                      {row.ctr.toFixed(2)}%
                    </td>
                    <td className="px-4 py-3 text-[#a0a0a0]">
                      {row.conv_rate.toFixed(2)}%
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Recent Postbacks */}
      <section>
        <p className="text-xs text-[#6b6b6b] uppercase tracking-wide mb-3">
          Recent Postbacks
        </p>
        <div className="bg-[#141414] border border-[#1e1e1e] rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#1e1e1e]">
                {["Source", "Click ID", "Event", "Status", "Time"].map((h) => (
                  <th
                    key={h}
                    className="text-[#6b6b6b] text-xs font-medium text-left px-4 py-3"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {postbacks.length === 0 && !loading ? (
                <tr>
                  <td
                    colSpan={5}
                    className="text-center text-[#6b6b6b] text-xs py-8"
                  >
                    No postbacks yet
                  </td>
                </tr>
              ) : (
                postbacks.map((pb) => (
                  <tr
                    key={pb.id}
                    className="border-b border-[#1e1e1e] last:border-0 hover:bg-[#1a1a1a] transition-colors"
                  >
                    <td className="px-4 py-3 text-white">
                      {pb.ad_source_name || `#${pb.ad_source_id}`}
                    </td>
                    <td className="px-4 py-3 text-[#a0a0a0] font-mono text-xs max-w-[160px] truncate">
                      {pb.click_id}
                    </td>
                    <td className="px-4 py-3 text-[#a0a0a0]">
                      {pb.event_type}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={pb.status} />
                    </td>
                    <td className="px-4 py-3 text-[#6b6b6b] text-xs whitespace-nowrap">
                      {formatTime(pb.created_at)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
