"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  getAllBanners,
  getBannerSizes,
  createBannerSize,
  getAdSources,
  createAdSource,
  updateAdSource,
  getBannerFunnel,
  getPostbacks,
  getPerfSummary,
  getDeviceBreakdown,
  getReferrerStats,
} from "@/lib/admin-api";
import type {
  AdminBanner,
  BannerSize,
  AdSource,
  BannerFunnelStat,
  ConversionPostback,
  PerfSummary,
  DeviceBreakdown,
  ReferrerStat,
} from "@/lib/admin-api";
import { ToastProvider, useToast } from "../Toast";

// ─── Tab types ───────────────────────────────────────────────────────────────

type PromoTab = "banners" | "statistics" | "performance" | "settings";

// ─── Banners Tab ─────────────────────────────────────────────────────────────

function EmbedCodeSection({
  sizes,
  sources,
  toast,
}: {
  sizes: BannerSize[];
  sources: AdSource[];
  toast: (msg: string, type?: "error" | "success" | "info") => void;
}) {
  const [selectedSource, setSelectedSource] = useState("");
  const [selectedStyle, setSelectedStyle] = useState("");
  const [previewSizeId, setPreviewSizeId] = useState<number | null>(null);
  const [iframeKey, setIframeKey] = useState(0);

  const buildServeUrl = (size: BannerSize) => {
    const params = new URLSearchParams();
    params.set("size", `${size.width}x${size.height}`);
    if (selectedSource) params.set("src", selectedSource);
    if (selectedStyle) params.set("style", selectedStyle);
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `${origin}/b/serve?${params.toString()}`;
  };

  // Ad network macros to include in embed code when a source is selected.
  const adNetworkMacros: Record<string, Record<string, string>> = {
    traforama: {
      "click-id": "%ID%",
      "ref-domain": "%REFDOMAIN%",
      "original-ref": "%ORIGINALREF%",
      "spot-id": "%SPOTID%",
      "node-id": "%NODEID%",
      "auction-price": "%AUCTIONPRICE%",
      "cpv-price": "%CPVPRICE%",
      cpc: "%CPC%",
      "campaign-id": "%CAMPAIGNID%",
      "creative-id": "%CREATIVEID%",
    },
  };

  const buildCode = (size: BannerSize) => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const attrs = [`data-size="${size.width}x${size.height}"`];
    if (selectedSource) attrs.push(`data-src="${selectedSource}"`);
    if (selectedStyle) attrs.push(`data-style="${selectedStyle}"`);
    // Add ad network macros if available for the selected source.
    const macros = selectedSource ? adNetworkMacros[selectedSource] : null;
    if (macros) {
      for (const [attr, macro] of Object.entries(macros)) {
        attrs.push(`data-${attr}="${macro}"`);
      }
    }
    return `<script async src="${origin}/b/loader.js" ${attrs.join(" ")}></script>`;
  };

  const buildIframeUrl = (size: BannerSize) => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    let u = `${origin}/b/serve?size=${size.width}x${size.height}`;
    if (selectedSource) u += `&src=${selectedSource}`;
    if (selectedStyle) u += `&style=${selectedStyle}`;
    const macros = selectedSource ? adNetworkMacros[selectedSource] : null;
    if (macros) {
      const paramMap: Record<string, string> = {
        "click-id": "click_id", "ref-domain": "ref_domain", "original-ref": "original_ref",
        "spot-id": "spot_id", "node-id": "node_id", "auction-price": "auction_price",
        "cpv-price": "cpv_price", cpc: "cpc", "campaign-id": "campaign_id", "creative-id": "creative_id",
      };
      for (const [attr, macro] of Object.entries(macros)) {
        u += `&${paramMap[attr] || attr}=${macro}`;
      }
    }
    return u;
  };

  const handleCopy = (code: string) => {
    navigator.clipboard.writeText(code);
    toast("Embed code copied");
  };

  return (
    <div className="mb-6">
      <h2 className="text-sm font-semibold text-white mb-3">Embed Code</h2>

      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <select
          value={selectedSource}
          onChange={(e) => setSelectedSource(e.target.value)}
          className="px-3 py-1.5 text-sm rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-white focus:outline-none focus:border-accent"
        >
          <option value="">No source</option>
          {sources.map((s) => (
            <option key={s.id} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          value={selectedStyle}
          onChange={(e) => setSelectedStyle(e.target.value)}
          className="px-3 py-1.5 text-sm rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-white focus:outline-none focus:border-accent"
        >
          <option value="">Random style</option>
          <option value="bold">Bold</option>
          <option value="elegant">Elegant</option>
          <option value="minimalist">Minimalist</option>
          <option value="card">Card</option>
        </select>
      </div>

      <div className="space-y-2">
        {sizes.map((size) => (
          <div
            key={size.id}
            className="bg-[#141414] rounded-lg border border-[#1e1e1e] p-3"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-white">
                {size.label || `${size.width}x${size.height}`}{" "}
                <span className="text-[#6b6b6b]">
                  ({size.width}x{size.height})
                </span>
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => {
                    setPreviewSizeId(previewSizeId === size.id ? null : size.id);
                    setIframeKey(Date.now());
                  }}
                  className={`px-2 py-1 text-[10px] rounded transition-colors ${
                    previewSizeId === size.id
                      ? "bg-accent text-white"
                      : "bg-[#1e1e1e] text-[#a0a0a0] hover:text-white hover:bg-[#252525]"
                  }`}
                >
                  Preview
                </button>
                <button
                  onClick={() => handleCopy(buildCode(size))}
                  className="px-2 py-1 text-[10px] rounded bg-[#1e1e1e] text-[#a0a0a0] hover:text-white hover:bg-[#252525] transition-colors"
                >
                  Copy JS
                </button>
                {selectedSource && adNetworkMacros[selectedSource] && (
                  <button
                    onClick={() => handleCopy(buildIframeUrl(size))}
                    className="px-2 py-1 text-[10px] rounded bg-[#1e1e1e] text-[#a0a0a0] hover:text-white hover:bg-[#252525] transition-colors"
                  >
                    Copy URL
                  </button>
                )}
              </div>
            </div>
            <pre className="text-[11px] text-[#6b6b6b] bg-[#0a0a0a] rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
              {buildCode(size)}
            </pre>
            {selectedSource && adNetworkMacros[selectedSource] && (
              <pre className="text-[11px] text-[#6b6b6b] bg-[#0a0a0a] rounded p-2 overflow-x-auto whitespace-pre-wrap break-all mt-1">
                {buildIframeUrl(size)}
              </pre>
            )}
            {previewSizeId === size.id && (
              <div className="mt-3 pt-3 border-t border-[#1e1e1e]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] text-[#6b6b6b]">Live Preview</span>
                  <button
                    onClick={() => setIframeKey(Date.now())}
                    className="px-2 py-1 text-[10px] rounded bg-[#1e1e1e] text-[#a0a0a0] hover:text-white hover:bg-[#252525] transition-colors"
                  >
                    Reload
                  </button>
                </div>
                <div className="bg-[#0a0a0a] rounded p-2 inline-block">
                  <iframe
                    key={iframeKey}
                    src={`${buildServeUrl(size)}&_t=${iframeKey}`}
                    width={size.width}
                    height={size.height}
                    frameBorder="0"
                    scrolling="no"
                    style={{ border: "none", overflow: "hidden", display: "block" }}
                  />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function BannersTab({
  sizes,
  sources,
  onSizesChange,
}: {
  sizes: BannerSize[];
  sources: AdSource[];
  onSizesChange: () => void;
}) {
  const [banners, setBanners] = useState<AdminBanner[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showAddSize, setShowAddSize] = useState(false);
  const [newWidth, setNewWidth] = useState("");
  const [newHeight, setNewHeight] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newType, setNewType] = useState("image");
  const [addingSizes, setAddingSizes] = useState(false);
  const { toast } = useToast();

  const loadBanners = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const result = await getAllBanners({ page: p, per_page: 20 });
      setBanners(result.banners);
      setTotal(result.total);
      setTotalPages(result.total_pages);
      setPage(result.page);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to load banners", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadBanners(1);
  }, [loadBanners]);

  const handleAddSize = async () => {
    const w = parseInt(newWidth);
    const h = parseInt(newHeight);
    if (!w || !h || w <= 0 || h <= 0) {
      toast("Width and height must be positive numbers", "error");
      return;
    }
    setAddingSizes(true);
    try {
      await createBannerSize({ width: w, height: h, label: newLabel, type: newType });
      toast(`Banner size ${w}x${h} created`);
      setNewWidth("");
      setNewHeight("");
      setNewLabel("");
      setNewType("image");
      setShowAddSize(false);
      onSizesChange();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to create size", "error");
    } finally {
      setAddingSizes(false);
    }
  };

  const handleCopyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    toast("URL copied");
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-sm text-[#6b6b6b]">{total} banners total</p>
        </div>
        <button
          onClick={() => setShowAddSize(!showAddSize)}
          className="px-3 py-2 text-sm rounded-lg bg-[#1e1e1e] text-[#a0a0a0] hover:text-white hover:bg-[#252525] transition-colors"
        >
          {showAddSize ? "Cancel" : "Add Banner Size"}
        </button>
      </div>

      {/* Add size form */}
      {showAddSize && (
        <div className="bg-[#141414] rounded-lg border border-[#1e1e1e] p-4 mb-6">
          <div className="flex items-end gap-3">
            <div>
              <label className="block text-xs text-[#6b6b6b] mb-1">Width</label>
              <input
                type="number"
                value={newWidth}
                onChange={(e) => setNewWidth(e.target.value)}
                placeholder="300"
                className="w-24 px-3 py-2 text-sm rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-white placeholder-[#4a4a4a] focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="block text-xs text-[#6b6b6b] mb-1">Height</label>
              <input
                type="number"
                value={newHeight}
                onChange={(e) => setNewHeight(e.target.value)}
                placeholder="250"
                className="w-24 px-3 py-2 text-sm rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-white placeholder-[#4a4a4a] focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="block text-xs text-[#6b6b6b] mb-1">Type</label>
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value)}
                className="px-3 py-2 text-sm rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-white focus:outline-none focus:border-accent"
              >
                <option value="image">Image</option>
                <option value="video">Video</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs text-[#6b6b6b] mb-1">Label</label>
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Medium Rectangle"
                className="w-full px-3 py-2 text-sm rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-white placeholder-[#4a4a4a] focus:outline-none focus:border-accent"
              />
            </div>
            <button
              onClick={handleAddSize}
              disabled={addingSizes}
              className="px-4 py-2 text-sm rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-40 transition-colors"
            >
              {addingSizes ? "Adding..." : "Add"}
            </button>
          </div>
        </div>
      )}

      {/* Banner sizes */}
      {sizes.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2 mb-6">
          {sizes.map((s) => (
            <div
              key={s.id}
              className={`bg-[#141414] rounded-lg border border-[#1e1e1e] p-3 ${
                s.is_active ? "" : "opacity-50"
              }`}
            >
              <div className="text-sm font-medium text-white">
                {s.width}x{s.height}
              </div>
              <div className="text-xs text-[#6b6b6b]">{s.label}</div>
              <div className="text-[10px] text-[#4a4a4a] mt-0.5">{s.type}</div>
            </div>
          ))}
        </div>
      )}

      {/* Embed Code */}
      {sizes.filter((s) => s.is_active).length > 0 && (
        <EmbedCodeSection
          sizes={sizes.filter((s) => s.is_active)}
          sources={sources}
          toast={toast}
        />
      )}

      {/* Banner list */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <span className="text-[#6b6b6b] text-sm">Loading...</span>
        </div>
      ) : banners.length === 0 ? (
        <div className="flex items-center justify-center py-20">
          <span className="text-[#6b6b6b] text-sm">
            No banners yet. Enable promotion on accounts to start generating.
          </span>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-4">
            {banners.map((b) => (
              <div
                key={b.id}
                className="bg-[#141414] rounded-lg border border-[#1e1e1e] overflow-hidden"
              >
                <div className="bg-[#0a0a0a] p-2">
                  <img
                    src={b.image_url}
                    alt={b.video_title}
                    width={b.width}
                    height={b.height}
                    style={{ width: b.width, height: b.height }}
                  />
                </div>
                <div className="p-3" style={{ width: Math.max(b.width + 16, 200) }}>
                  <div className="text-xs text-white truncate mb-0.5">
                    {b.video_title || `Video #${b.video_id}`}
                  </div>
                  <Link
                    href={`/admin/accounts/${b.account_id}`}
                    className="text-[10px] text-accent hover:underline"
                  >
                    @{b.username}
                  </Link>
                  <div className="text-[10px] text-[#6b6b6b] mt-1">
                    Imprs: {b.impressions || 0} &nbsp;|&nbsp; Hovers: {b.hovers || 0} &nbsp;|&nbsp; Clicks: {b.clicks || 0} &nbsp;|&nbsp; CTR: {b.ctr || 0}%
                  </div>
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-[10px] text-[#6b6b6b]">
                      {b.width}x{b.height}
                    </span>
                    <button
                      onClick={() => handleCopyUrl(b.image_url)}
                      className="text-[10px] text-[#6b6b6b] hover:text-accent transition-colors"
                    >
                      Copy URL
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-4">
              <button
                onClick={() => loadBanners(Math.max(1, page - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 text-sm rounded-lg bg-[#1e1e1e] text-[#a0a0a0] hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Prev
              </button>
              <span className="text-sm text-[#6b6b6b]">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => loadBanners(Math.min(totalPages, page + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1.5 text-sm rounded-lg bg-[#1e1e1e] text-[#a0a0a0] hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Statistics Tab ──────────────────────────────────────────────────────────

function StatisticsTab() {
  const [days, setDays] = useState(30);
  const [funnel, setFunnel] = useState<BannerFunnelStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [postbacks, setPostbacks] = useState<ConversionPostback[]>([]);
  const { toast } = useToast();

  const loadData = useCallback(async (d: number) => {
    setLoading(true);
    try {
      const [funnelRes, pbRes] = await Promise.all([
        getBannerFunnel(d),
        getPostbacks(30),
      ]);
      setFunnel(funnelRes.funnel);
      setPostbacks(pbRes);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to load stats", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadData(days);
  }, [days, loadData]);

  // Compute totals for funnel summary.
  const totals = funnel.reduce(
    (acc, s) => ({
      impressions: acc.impressions + s.impressions,
      hovers: acc.hovers + s.hovers,
      clicks: acc.clicks + s.clicks,
      landings: acc.landings + s.landings,
      conversions: acc.conversions + s.conversions,
    }),
    { impressions: 0, hovers: 0, clicks: 0, landings: 0, conversions: 0 },
  );

  const totalCTR = totals.impressions > 0
    ? ((totals.clicks / totals.impressions) * 100).toFixed(2)
    : "0";
  const totalConvRate = totals.clicks > 0
    ? ((totals.conversions / totals.clicks) * 100).toFixed(2)
    : "0";

  return (
    <div>
      {/* Period selector */}
      <div className="flex items-center gap-2 mb-6">
        {[7, 30, 90].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
              days === d
                ? "bg-accent text-white"
                : "bg-[#1e1e1e] text-[#a0a0a0] hover:text-white hover:bg-[#252525]"
            }`}
          >
            {d}d
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <span className="text-[#6b6b6b] text-sm">Loading...</span>
        </div>
      ) : (
        <>
          {/* Funnel summary */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3 mb-6">
            {[
              { label: "Impressions", value: totals.impressions },
              { label: "Hovers", value: totals.hovers },
              { label: "Clicks", value: totals.clicks },
              { label: "Landings", value: totals.landings },
              { label: "Conversions", value: totals.conversions },
              { label: "CTR", value: `${totalCTR}%` },
              { label: "Conv Rate", value: `${totalConvRate}%` },
            ].map((item) => (
              <div
                key={item.label}
                className="bg-[#141414] rounded-lg border border-[#1e1e1e] p-3"
              >
                <div className="text-[10px] text-[#6b6b6b] mb-0.5">{item.label}</div>
                <div className="text-lg font-bold text-white">
                  {typeof item.value === "number" ? item.value.toLocaleString() : item.value}
                </div>
              </div>
            ))}
          </div>

          {/* Funnel by source table */}
          {funnel.length > 0 ? (
            <div className="bg-[#141414] rounded-lg border border-[#1e1e1e] overflow-hidden mb-6">
              <div className="px-4 py-3 border-b border-[#1e1e1e]">
                <h3 className="text-sm font-semibold text-white">By Source</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[#6b6b6b] text-xs border-b border-[#1e1e1e]">
                      <th className="text-left px-4 py-2 font-medium">Source</th>
                      <th className="text-right px-4 py-2 font-medium">Impressions</th>
                      <th className="text-right px-4 py-2 font-medium">Hovers</th>
                      <th className="text-right px-4 py-2 font-medium">Clicks</th>
                      <th className="text-right px-4 py-2 font-medium">Landings</th>
                      <th className="text-right px-4 py-2 font-medium">Conversions</th>
                      <th className="text-right px-4 py-2 font-medium">CTR</th>
                      <th className="text-right px-4 py-2 font-medium">Conv%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {funnel.map((row) => (
                      <tr
                        key={row.source}
                        className="border-b border-[#1e1e1e] last:border-b-0 hover:bg-[#1a1a1a] transition-colors"
                      >
                        <td className="px-4 py-2.5 text-white font-medium">{row.source}</td>
                        <td className="px-4 py-2.5 text-right text-[#a0a0a0]">{row.impressions.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-right text-[#a0a0a0]">{row.hovers.toLocaleString()}</td>
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
          ) : (
            <div className="flex items-center justify-center py-10 mb-6">
              <span className="text-[#6b6b6b] text-sm">No funnel data for this period</span>
            </div>
          )}

          {/* Recent postbacks */}
          {postbacks.length > 0 && (
            <div className="bg-[#141414] rounded-lg border border-[#1e1e1e] overflow-hidden">
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
                      <th className="text-right px-4 py-2 font-medium">Code</th>
                      <th className="text-left px-4 py-2 font-medium">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {postbacks.map((pb) => (
                      <tr
                        key={pb.id}
                        className="border-b border-[#1e1e1e] last:border-b-0 hover:bg-[#1a1a1a] transition-colors"
                      >
                        <td className="px-4 py-2 text-white">{pb.ad_source_name}</td>
                        <td className="px-4 py-2 text-[#a0a0a0] font-mono text-xs truncate max-w-[150px]">{pb.click_id}</td>
                        <td className="px-4 py-2 text-[#a0a0a0]">{pb.event_type}</td>
                        <td className="px-4 py-2">
                          <span
                            className={`inline-block px-1.5 py-0.5 text-[10px] rounded ${
                              pb.status === "sent"
                                ? "bg-green-900/50 text-green-400"
                                : pb.status === "failed"
                                  ? "bg-red-900/50 text-red-400"
                                  : "bg-yellow-900/50 text-yellow-400"
                            }`}
                          >
                            {pb.status}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right text-[#a0a0a0]">{pb.response_code || "-"}</td>
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

// ─── Settings Tab ────────────────────────────────────────────────────────────

function SettingsTab({
  sources,
  onSourcesChange,
}: {
  sources: AdSource[];
  onSourcesChange: () => void;
}) {
  const [showAddSource, setShowAddSource] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const handleAdd = async () => {
    if (!newName.trim()) {
      toast("Name is required", "error");
      return;
    }
    setSaving(true);
    try {
      await createAdSource({ name: newName.trim(), postback_url: newUrl.trim() });
      toast(`Ad source "${newName}" created`);
      setNewName("");
      setNewUrl("");
      setShowAddSource(false);
      onSourcesChange();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to create source", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (source: AdSource) => {
    try {
      await updateAdSource(source.id, { is_active: !source.is_active });
      toast(`${source.name} ${source.is_active ? "disabled" : "enabled"}`);
      onSourcesChange();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update", "error");
    }
  };

  return (
    <div>
      {/* Ad Sources section */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-white">Ad Sources</h2>
            <p className="text-xs text-[#6b6b6b] mt-0.5">
              Traffic sources for banner campaigns. Postback URL uses {"{click_id}"} and {"{event}"} placeholders.
            </p>
          </div>
          <button
            onClick={() => setShowAddSource(!showAddSource)}
            className="px-3 py-1.5 text-sm rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors"
          >
            {showAddSource ? "Cancel" : "Add Source"}
          </button>
        </div>

        {/* Add form */}
        {showAddSource && (
          <div className="bg-[#141414] rounded-lg border border-[#1e1e1e] p-4 mb-4">
            <div className="flex items-end gap-3">
              <div className="w-48">
                <label className="block text-xs text-[#6b6b6b] mb-1">Name (unique)</label>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="adnet1"
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-white placeholder-[#4a4a4a] focus:outline-none focus:border-accent"
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-[#6b6b6b] mb-1">Postback URL</label>
                <input
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  placeholder="https://adnetwork.com/postback?click_id={click_id}&event={event}"
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-white placeholder-[#4a4a4a] focus:outline-none focus:border-accent"
                />
              </div>
              <button
                onClick={handleAdd}
                disabled={saving}
                className="px-4 py-2 text-sm rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-40 transition-colors"
              >
                {saving ? "Saving..." : "Add"}
              </button>
            </div>
          </div>
        )}

        {/* Sources list */}
        {sources.length === 0 ? (
          <div className="flex items-center justify-center py-10">
            <span className="text-[#6b6b6b] text-sm">No ad sources configured</span>
          </div>
        ) : (
          <div className="space-y-2">
            {sources.map((s) => (
              <div
                key={s.id}
                className={`bg-[#141414] rounded-lg border border-[#1e1e1e] p-4 ${
                  s.is_active ? "" : "opacity-60"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white">{s.name}</span>
                      <span
                        className={`inline-block px-1.5 py-0.5 text-[10px] rounded ${
                          s.is_active
                            ? "bg-green-900/50 text-green-400"
                            : "bg-[#1e1e1e] text-[#6b6b6b]"
                        }`}
                      >
                        {s.is_active ? "active" : "inactive"}
                      </span>
                    </div>
                    {s.postback_url && (
                      <div className="text-xs text-[#6b6b6b] mt-1 truncate">
                        {s.postback_url}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => handleToggle(s)}
                    className="ml-4 px-3 py-1 text-xs rounded-lg bg-[#1e1e1e] text-[#a0a0a0] hover:text-white hover:bg-[#252525] transition-colors"
                  >
                    {s.is_active ? "Disable" : "Enable"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Conversion tracker info */}
      <div>
        <h2 className="text-sm font-semibold text-white mb-2">Conversion Tracking</h2>
        <div className="bg-[#141414] rounded-lg border border-[#1e1e1e] p-4">
          <p className="text-xs text-[#a0a0a0] mb-3">
            When a visitor clicks a fansite link (OnlyFans, Fansly) or content link (Instagram, Twitter),
            the system fires a GET postback to the matching ad source using the stored click_id.
          </p>
          <div className="text-xs text-[#6b6b6b] space-y-1.5">
            <div><span className="text-white">Trigger events:</span> social_click (fansite), content_click (first content click per session)</div>
            <div><span className="text-white">URL placeholders:</span> {"{click_id}"} — ad network click ID, {"{event}"} — event type, {"{cpa}"} — CPA price (per model), {"{event_id}"} — event number 1-9 (per model per source)</div>
            <div><span className="text-white">Retry:</span> Failed postbacks are retried every 5 minutes, up to 3 attempts</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Performance Tab ─────────────────────────────────────────────────────────

function PerformanceTab() {
  const [days, setDays] = useState(7);
  const [perfSummary, setPerfSummary] = useState<PerfSummary[]>([]);
  const [deviceBreakdown, setDeviceBreakdown] = useState<DeviceBreakdown[]>([]);
  const [referrerStats, setReferrerStats] = useState<ReferrerStat[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const loadData = useCallback(async (d: number) => {
    setLoading(true);
    try {
      const [perfRes, deviceRes, refRes] = await Promise.all([
        getPerfSummary(d),
        getDeviceBreakdown(d),
        getReferrerStats(d),
      ]);
      setPerfSummary(perfRes);
      setDeviceBreakdown(deviceRes);
      setReferrerStats(refRes);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to load performance data", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadData(days);
  }, [days, loadData]);

  // Compute overview aggregates from PerfSummary data.
  const totalEvents = perfSummary.reduce((sum, r) => sum + r.total_events, 0);
  const avgLoadTime = totalEvents > 0
    ? perfSummary.reduce((sum, r) => sum + r.avg_image_load_ms * r.total_events, 0) / totalEvents
    : 0;
  const avgRenderTime = totalEvents > 0
    ? perfSummary.reduce((sum, r) => sum + r.avg_render_ms * r.total_events, 0) / totalEvents
    : 0;
  const avgViewability = totalEvents > 0
    ? perfSummary.reduce((sum, r) => sum + r.viewability_rate * r.total_events, 0) / totalEvents
    : 0;
  const avgDwellTime = totalEvents > 0
    ? perfSummary.reduce((sum, r) => sum + r.avg_dwell_time_ms * r.total_events, 0) / totalEvents
    : 0;

  return (
    <div>
      {/* Period selector */}
      <div className="flex items-center gap-2 mb-6">
        {[7, 30, 90].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
              days === d
                ? "bg-accent text-white"
                : "bg-[#1e1e1e] text-[#a0a0a0] hover:text-white hover:bg-[#252525]"
            }`}
          >
            {d}d
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <span className="text-[#6b6b6b] text-sm">Loading...</span>
        </div>
      ) : (
        <>
          {/* Overview cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {[
              { label: "Avg Load Time", value: `${Math.round(avgLoadTime)} ms` },
              { label: "Avg Render Time", value: `${Math.round(avgRenderTime)} ms` },
              { label: "Viewability Rate", value: `${avgViewability.toFixed(1)}%` },
              { label: "Avg Dwell Time", value: `${Math.round(avgDwellTime)} ms` },
            ].map((item) => (
              <div
                key={item.label}
                className="bg-[#141414] rounded-lg border border-[#1e1e1e] p-3"
              >
                <div className="text-[10px] text-[#6b6b6b] mb-0.5">{item.label}</div>
                <div className="text-lg font-bold text-white">{item.value}</div>
              </div>
            ))}
          </div>

          {/* Performance by Device Type */}
          {perfSummary.length > 0 ? (
            <div className="bg-[#141414] rounded-lg border border-[#1e1e1e] overflow-hidden mb-6">
              <div className="px-4 py-3 border-b border-[#1e1e1e]">
                <h3 className="text-sm font-semibold text-white">Performance by Device Type</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[#6b6b6b] text-xs border-b border-[#1e1e1e]">
                      <th className="text-left px-4 py-2 font-medium">Device Type</th>
                      <th className="text-right px-4 py-2 font-medium">Total Events</th>
                      <th className="text-right px-4 py-2 font-medium">Avg Image Load (ms)</th>
                      <th className="text-right px-4 py-2 font-medium">Avg Render (ms)</th>
                      <th className="text-right px-4 py-2 font-medium">P95 Image Load (ms)</th>
                      <th className="text-right px-4 py-2 font-medium">P95 Render (ms)</th>
                      <th className="text-right px-4 py-2 font-medium">Viewability Rate (%)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {perfSummary.map((row, idx) => (
                      <tr
                        key={idx}
                        className="border-b border-[#1e1e1e] last:border-b-0 hover:bg-[#1a1a1a] transition-colors"
                      >
                        <td className="px-4 py-2.5 text-white font-medium">{row.device_type}</td>
                        <td className="px-4 py-2.5 text-right text-[#a0a0a0]">{row.total_events.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-right text-[#a0a0a0]">{Math.round(row.avg_image_load_ms)}</td>
                        <td className="px-4 py-2.5 text-right text-[#a0a0a0]">{Math.round(row.avg_render_ms)}</td>
                        <td className="px-4 py-2.5 text-right text-[#a0a0a0]">{Math.round(row.p95_image_load_ms)}</td>
                        <td className="px-4 py-2.5 text-right text-[#a0a0a0]">{Math.round(row.p95_render_ms)}</td>
                        <td className="px-4 py-2.5 text-right text-[#a0a0a0]">{row.viewability_rate.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center py-10 mb-6">
              <span className="text-[#6b6b6b] text-sm">No performance data for this period</span>
            </div>
          )}

          {/* Device & Browser Breakdown */}
          {deviceBreakdown.length > 0 && (
            <div className="bg-[#141414] rounded-lg border border-[#1e1e1e] overflow-hidden mb-6">
              <div className="px-4 py-3 border-b border-[#1e1e1e]">
                <h3 className="text-sm font-semibold text-white">Device & Browser Breakdown</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[#6b6b6b] text-xs border-b border-[#1e1e1e]">
                      <th className="text-left px-4 py-2 font-medium">Device</th>
                      <th className="text-left px-4 py-2 font-medium">OS</th>
                      <th className="text-left px-4 py-2 font-medium">Browser</th>
                      <th className="text-right px-4 py-2 font-medium">Impressions</th>
                      <th className="text-right px-4 py-2 font-medium">Clicks</th>
                      <th className="text-right px-4 py-2 font-medium">CTR (%)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deviceBreakdown.map((row, idx) => (
                      <tr
                        key={idx}
                        className="border-b border-[#1e1e1e] last:border-b-0 hover:bg-[#1a1a1a] transition-colors"
                      >
                        <td className="px-4 py-2.5 text-white font-medium">{row.device_type}</td>
                        <td className="px-4 py-2.5 text-[#a0a0a0]">{row.os}</td>
                        <td className="px-4 py-2.5 text-[#a0a0a0]">{row.browser}</td>
                        <td className="px-4 py-2.5 text-right text-[#a0a0a0]">{row.events.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-right text-[#a0a0a0]">{row.clicks.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-right text-[#a0a0a0]">{row.ctr.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Top Referrers */}
          {referrerStats.length > 0 && (
            <div className="bg-[#141414] rounded-lg border border-[#1e1e1e] overflow-hidden">
              <div className="px-4 py-3 border-b border-[#1e1e1e]">
                <h3 className="text-sm font-semibold text-white">Top Referrers</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[#6b6b6b] text-xs border-b border-[#1e1e1e]">
                      <th className="text-left px-4 py-2 font-medium">Referrer Domain</th>
                      <th className="text-right px-4 py-2 font-medium">Impressions</th>
                      <th className="text-right px-4 py-2 font-medium">Clicks</th>
                      <th className="text-right px-4 py-2 font-medium">CTR (%)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {referrerStats.map((row, idx) => (
                      <tr
                        key={idx}
                        className="border-b border-[#1e1e1e] last:border-b-0 hover:bg-[#1a1a1a] transition-colors"
                      >
                        <td className="px-4 py-2.5 text-white font-medium">{row.referrer_domain}</td>
                        <td className="px-4 py-2.5 text-right text-[#a0a0a0]">{row.impressions.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-right text-[#a0a0a0]">{row.clicks.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-right text-[#a0a0a0]">{row.ctr.toFixed(1)}</td>
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

// ─── Main PromoContent ───────────────────────────────────────────────────────

function PromoContent() {
  const [tab, setTab] = useState<PromoTab>("banners");
  const [sizes, setSizes] = useState<BannerSize[]>([]);
  const [sources, setSources] = useState<AdSource[]>([]);

  const loadSizes = useCallback(async () => {
    try {
      setSizes(await getBannerSizes());
    } catch {
      // silent
    }
  }, []);

  const loadSources = useCallback(async () => {
    try {
      setSources(await getAdSources());
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    loadSizes();
    loadSources();
  }, [loadSizes, loadSources]);

  const tabs: { key: PromoTab; label: string }[] = [
    { key: "banners", label: "Banners" },
    { key: "statistics", label: "Statistics" },
    { key: "performance", label: "Performance" },
    { key: "settings", label: "Settings" },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-bold text-white">Promo</h1>
        <div className="flex items-center gap-1 bg-[#141414] rounded-lg border border-[#1e1e1e] p-0.5">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                tab === t.key
                  ? "bg-[#252525] text-white"
                  : "text-[#6b6b6b] hover:text-[#a0a0a0]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "banners" && (
        <BannersTab sizes={sizes} sources={sources} onSizesChange={loadSizes} />
      )}
      {tab === "statistics" && <StatisticsTab />}
      {tab === "performance" && <PerformanceTab />}
      {tab === "settings" && (
        <SettingsTab sources={sources} onSourcesChange={loadSources} />
      )}
    </div>
  );
}

export default function PromoPage() {
  return (
    <ToastProvider>
      <PromoContent />
    </ToastProvider>
  );
}
