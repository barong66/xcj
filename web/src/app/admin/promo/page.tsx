"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  getAllBanners,
  getBannerSizes,
  createBannerSize,
  getAdminCategories,
} from "@/lib/admin-api";
import type { AdminBanner, AdminCategory, BannerSize } from "@/lib/admin-api";
import { ToastProvider, useToast } from "../Toast";

function EmbedCodeSection({
  sizes,
  toast,
}: {
  sizes: BannerSize[];
  toast: (msg: string, type?: "error" | "success" | "info") => void;
}) {
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [selectedCat, setSelectedCat] = useState("");
  const [keywords, setKeywords] = useState("");

  useEffect(() => {
    getAdminCategories().then(setCategories).catch(() => {});
  }, []);

  const buildCode = (size: BannerSize) => {
    const params = new URLSearchParams();
    params.set("size", `${size.width}x${size.height}`);
    if (selectedCat) params.set("cat", selectedCat);
    if (keywords.trim()) params.set("kw", keywords.trim());

    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const src = `${origin}/b/serve?${params.toString()}`;

    return `<iframe src="${src}" width="${size.width}" height="${size.height}" frameborder="0" scrolling="no" style="border:none;overflow:hidden"></iframe>`;
  };

  const handleCopy = (code: string) => {
    navigator.clipboard.writeText(code);
    toast("Embed code copied");
  };

  return (
    <div className="mb-6">
      <h2 className="text-sm font-semibold text-white mb-3">Embed Code</h2>

      <div className="flex items-center gap-3 mb-3">
        <select
          value={selectedCat}
          onChange={(e) => setSelectedCat(e.target.value)}
          className="px-3 py-1.5 text-sm rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-white focus:outline-none focus:border-accent"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
        <input
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          placeholder="Keywords (optional)"
          className="px-3 py-1.5 text-sm rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-white placeholder-[#4a4a4a] focus:outline-none focus:border-accent"
        />
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
              <button
                onClick={() => handleCopy(buildCode(size))}
                className="px-2 py-1 text-[10px] rounded bg-[#1e1e1e] text-[#a0a0a0] hover:text-white hover:bg-[#252525] transition-colors"
              >
                Copy
              </button>
            </div>
            <pre className="text-[11px] text-[#6b6b6b] bg-[#0a0a0a] rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
              {buildCode(size)}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}

function PromoContent() {
  const [banners, setBanners] = useState<AdminBanner[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [sizes, setSizes] = useState<BannerSize[]>([]);
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

  const loadSizes = useCallback(async () => {
    try {
      const s = await getBannerSizes();
      setSizes(s);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    loadBanners(1);
    loadSizes();
  }, [loadBanners, loadSizes]);

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
        <div>
          <h1 className="text-lg font-bold text-white">Promo Banners</h1>
          <p className="text-sm text-[#6b6b6b] mt-0.5">{total} banners total</p>
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
        <EmbedCodeSection sizes={sizes.filter((s) => s.is_active)} toast={toast} />
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
                    Imprs: {b.impressions || 0} &nbsp;|&nbsp; Clicks: {b.clicks || 0} &nbsp;|&nbsp; CTR: {b.ctr || 0}%
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
