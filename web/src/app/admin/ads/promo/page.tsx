"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  getAllBanners,
  getBannerSizes,
  createBannerSize,
  getAdSources,
} from "@/lib/admin-api";
import type {
  AdminBanner,
  BannerSize,
  AdSource,
} from "@/lib/admin-api";
import { ToastProvider, useToast } from "../../Toast";

// ─── Embed Code Section ───────────────────────────────────────────────────────

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

// ─── Promo Content ────────────────────────────────────────────────────────────

function PromoContent() {
  const [banners, setBanners] = useState<AdminBanner[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [sizes, setSizes] = useState<BannerSize[]>([]);
  const [sources, setSources] = useState<AdSource[]>([]);
  const [showAddSize, setShowAddSize] = useState(false);
  const [newWidth, setNewWidth] = useState("");
  const [newHeight, setNewHeight] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newType, setNewType] = useState("image");
  const [addingSizes, setAddingSizes] = useState(false);
  const { toast } = useToast();

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
    loadSizes();
    loadSources();
    loadBanners(1);
  }, [loadSizes, loadSources, loadBanners]);

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
      loadSizes();
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
        <h1 className="text-lg font-bold text-white">Promo</h1>
        <button
          onClick={() => setShowAddSize(!showAddSize)}
          className="px-3 py-2 text-sm rounded-lg bg-[#1e1e1e] text-[#a0a0a0] hover:text-white hover:bg-[#252525] transition-colors"
        >
          {showAddSize ? "Cancel" : "Add Banner Size"}
        </button>
      </div>

      <p className="text-sm text-[#6b6b6b] mb-6">{total} banners total</p>

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

export default function PromoPage() {
  return (
    <ToastProvider>
      <PromoContent />
    </ToastProvider>
  );
}
