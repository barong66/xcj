"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  getAllBanners,
  getBannerSizes,
  createBannerSize,
} from "@/lib/admin-api";
import type { AdminBanner, BannerSize } from "@/lib/admin-api";
import { ToastProvider, useToast } from "../Toast";

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
      await createBannerSize({ width: w, height: h, label: newLabel });
      toast(`Banner size ${w}x${h} created`);
      setNewWidth("");
      setNewHeight("");
      setNewLabel("");
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
            </div>
          ))}
        </div>
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
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {banners.map((b) => (
              <div
                key={b.id}
                className="bg-[#141414] rounded-lg border border-[#1e1e1e] overflow-hidden group"
              >
                <div className="aspect-video bg-[#0a0a0a] flex items-center justify-center overflow-hidden">
                  <img
                    src={b.image_url}
                    alt={b.video_title}
                    className="max-w-full max-h-full object-contain"
                  />
                </div>
                <div className="p-3">
                  <div className="text-xs text-white truncate mb-0.5">
                    {b.video_title || `Video #${b.video_id}`}
                  </div>
                  <Link
                    href={`/admin/accounts/${b.account_id}`}
                    className="text-[10px] text-accent hover:underline"
                  >
                    @{b.username}
                  </Link>
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
