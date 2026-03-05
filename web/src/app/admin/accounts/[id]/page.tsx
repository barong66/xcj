"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  getAdminAccount,
  updateAdminAccount,
  reparseAccount,
  getAccountBannerSummary,
  getAccountBanners,
  generateAccountBanners,
} from "@/lib/admin-api";
import type {
  AdminAccount,
  BannerSizeSummary,
  AdminBanner,
  AdminBannerList,
} from "@/lib/admin-api";
import { ToastProvider, useToast } from "../../Toast";

const FAN_SITES = [
  { key: "onlyfans", label: "OnlyFans", placeholder: "username or full URL", color: "#00AFF0" },
  { key: "fansly", label: "Fansly", placeholder: "username or full URL", color: "#1FA7F2" },
  { key: "chaturbate", label: "Chaturbate", placeholder: "username or full URL", color: "#F69522" },
  { key: "manyvids", label: "ManyVids", placeholder: "username or full URL", color: "#FF4081" },
  { key: "stripchat", label: "Stripchat", placeholder: "username or full URL", color: "#C23B6E" },
] as const;

type Tab = "links" | "promo";

function AccountProfileContent() {
  const params = useParams();
  const router = useRouter();
  const id = Number(params.id);
  const [account, setAccount] = useState<AdminAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<Tab>("links");
  const { toast } = useToast();

  // Promo state
  const [bannerSummary, setBannerSummary] = useState<BannerSizeSummary[]>([]);
  const [banners, setBanners] = useState<AdminBanner[]>([]);
  const [bannersTotal, setBannersTotal] = useState(0);
  const [bannersPage, setBannersPage] = useState(1);
  const [bannersTotalPages, setBannersTotalPages] = useState(1);
  const [selectedSizeId, setSelectedSizeId] = useState<number | null>(null);
  const [bannersLoading, setBannersLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  const loadAccount = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getAdminAccount(id);
      setAccount(data);
      setLinks(data.social_links || {});
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to load account", "error");
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    loadAccount();
  }, [loadAccount]);

  // Load banner summary when promo tab is active
  const loadBannerSummary = useCallback(async () => {
    try {
      const summary = await getAccountBannerSummary(id);
      setBannerSummary(summary);
    } catch {
      // silent — table may not exist yet
    }
  }, [id]);

  const loadBanners = useCallback(async (sizeId: number | null, page: number) => {
    setBannersLoading(true);
    try {
      const result = await getAccountBanners(id, {
        size_id: sizeId ?? undefined,
        page,
        per_page: 12,
      });
      setBanners(result.banners);
      setBannersTotal(result.total);
      setBannersTotalPages(result.total_pages);
      setBannersPage(result.page);
    } catch {
      setBanners([]);
    } finally {
      setBannersLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (activeTab === "promo") {
      loadBannerSummary();
      loadBanners(selectedSizeId, 1);
    }
  }, [activeTab, loadBannerSummary, loadBanners, selectedSizeId]);

  const handleSaveLinks = async () => {
    if (!account) return;
    setSaving(true);
    try {
      const cleaned: Record<string, string> = {};
      for (const [k, v] of Object.entries(links)) {
        const trimmed = v.trim();
        if (trimmed) cleaned[k] = trimmed;
      }
      const updated = await updateAdminAccount(account.id, { social_links: cleaned });
      setAccount(updated);
      setLinks(updated.social_links || {});
      toast("Social links saved");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleReparse = async () => {
    if (!account) return;
    try {
      await reparseAccount(account.id);
      toast(`Enqueued reparse for @${account.username}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to reparse", "error");
    }
  };

  const handleToggleActive = async () => {
    if (!account) return;
    try {
      const updated = await updateAdminAccount(account.id, { is_active: !account.is_active });
      setAccount(updated);
      toast(`Account ${updated.is_active ? "activated" : "deactivated"}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update", "error");
    }
  };

  const handleTogglePaid = async () => {
    if (!account) return;
    try {
      const updated = await updateAdminAccount(account.id, { is_paid: !account.is_paid });
      setAccount(updated);
      toast(`Promotion ${updated.is_paid ? "enabled" : "disabled"}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update", "error");
    }
  };

  const handleGenerate = async () => {
    if (!account) return;
    setGenerating(true);
    try {
      await generateAccountBanners(account.id);
      toast("Banner generation enqueued");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to generate", "error");
    } finally {
      setGenerating(false);
    }
  };

  const handleCopyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    toast("URL copied");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="text-[#6b6b6b] text-sm">Loading...</span>
      </div>
    );
  }

  if (!account) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <span className="text-[#6b6b6b] text-sm">Account not found</span>
        <Link href="/admin/accounts" className="text-accent text-sm hover:underline">
          Back to accounts
        </Link>
      </div>
    );
  }

  const hasChanges = JSON.stringify(links) !== JSON.stringify(account.social_links || {});

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/admin/accounts"
          className="p-1.5 rounded-lg hover:bg-[#1e1e1e] text-[#6b6b6b] hover:text-white transition-colors"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </Link>
        <div className="flex items-center gap-3 flex-1">
          {account.avatar_url ? (
            <img src={account.avatar_url} alt="" className="w-10 h-10 rounded-full" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-[#2a2a2a] flex items-center justify-center text-lg text-[#6b6b6b]">
              {account.username.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <h1 className="text-lg font-bold text-white">@{account.username}</h1>
            <div className="flex items-center gap-2 text-xs text-[#6b6b6b]">
              <span className="capitalize">{account.platform}</span>
              <span>-</span>
              <span>{account.video_count} videos</span>
              {account.display_name && (
                <>
                  <span>-</span>
                  <span>{account.display_name}</span>
                </>
              )}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span
              className={`px-2 py-0.5 rounded text-xs font-medium ${
                account.is_active
                  ? "bg-green-500/10 text-green-400"
                  : "bg-red-500/10 text-red-400"
              }`}
            >
              {account.is_active ? "Active" : "Inactive"}
            </span>
            {account.is_paid && (
              <span className="px-1.5 py-0.5 text-[10px] rounded bg-yellow-500/20 text-yellow-400 font-medium">
                PAID
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <InfoCard label="Videos" value={account.video_count.toLocaleString()} />
        <InfoCard label="Followers" value={account.follower_count ? account.follower_count.toLocaleString() : "-"} />
        <InfoCard label="Parse Errors" value={String(account.parse_errors)} alert={account.parse_errors > 0} />
        <InfoCard
          label="Last Parsed"
          value={account.last_parsed_at ? new Date(account.last_parsed_at).toLocaleDateString() : "Never"}
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 mb-6">
        <button
          onClick={handleReparse}
          className="px-3 py-2 text-sm rounded-lg bg-[#1e1e1e] text-[#a0a0a0] hover:text-white hover:bg-[#252525] transition-colors"
        >
          Reparse
        </button>
        <button
          onClick={handleTogglePaid}
          className={`px-3 py-2 text-sm rounded-lg transition-colors ${
            account.is_paid
              ? "bg-yellow-500/15 text-yellow-400 hover:bg-yellow-500/25"
              : "bg-[#1e1e1e] text-[#a0a0a0] hover:text-white hover:bg-[#252525]"
          }`}
        >
          {account.is_paid ? "Disable Promotion" : "Enable Promotion"}
        </button>
        <button
          onClick={handleToggleActive}
          className="px-3 py-2 text-sm rounded-lg bg-[#1e1e1e] text-[#a0a0a0] hover:text-white hover:bg-[#252525] transition-colors"
        >
          {account.is_active ? "Deactivate" : "Activate"}
        </button>
        {account.slug && (
          <Link
            href={`/model/${account.slug}`}
            target="_blank"
            className="px-3 py-2 text-sm rounded-lg bg-[#1e1e1e] text-[#a0a0a0] hover:text-accent hover:bg-[#252525] transition-colors flex items-center gap-1.5"
          >
            View Profile
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </Link>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-[#1e1e1e]">
        <button
          onClick={() => setActiveTab("links")}
          className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
            activeTab === "links"
              ? "border-accent text-white"
              : "border-transparent text-[#6b6b6b] hover:text-[#a0a0a0]"
          }`}
        >
          Fan Site Links
        </button>
        <button
          onClick={() => setActiveTab("promo")}
          className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
            activeTab === "promo"
              ? "border-accent text-white"
              : "border-transparent text-[#6b6b6b] hover:text-[#a0a0a0]"
          }`}
        >
          Promo
        </button>
      </div>

      {/* Tab content */}
      {activeTab === "links" && (
        <div className="bg-[#141414] rounded-lg border border-[#1e1e1e] overflow-hidden">
          <div className="px-5 py-4 border-b border-[#1e1e1e] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Fan Site Links</h2>
            <button
              onClick={handleSaveLinks}
              disabled={saving || !hasChanges}
              className="px-3 py-1.5 text-sm rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
          <div className="p-5 space-y-3">
            {FAN_SITES.map((site) => (
              <div key={site.key} className="flex items-center gap-3">
                <div className="w-28 shrink-0 flex items-center gap-2">
                  <div
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: site.color }}
                  />
                  <span className="text-sm text-[#a0a0a0]">{site.label}</span>
                </div>
                <input
                  type="text"
                  value={links[site.key] || ""}
                  onChange={(e) =>
                    setLinks((prev) => ({ ...prev, [site.key]: e.target.value }))
                  }
                  placeholder={site.placeholder}
                  className="flex-1 px-3 py-2 text-sm rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-white placeholder-[#4a4a4a] focus:outline-none focus:border-accent transition-colors"
                />
                {links[site.key] && (
                  <button
                    onClick={() =>
                      setLinks((prev) => {
                        const next = { ...prev };
                        delete next[site.key];
                        return next;
                      })
                    }
                    className="p-1.5 rounded hover:bg-[#252525] text-[#6b6b6b] hover:text-red-400 transition-colors"
                    title="Clear"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === "promo" && (
        <div className="space-y-4">
          {/* Generate button */}
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Banners</h2>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="px-3 py-1.5 text-sm rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {generating ? "Generating..." : "Generate Banners"}
            </button>
          </div>

          {/* Banner size summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <button
              onClick={() => { setSelectedSizeId(null); setBannersPage(1); }}
              className={`bg-[#141414] rounded-lg border p-3 text-left transition-colors ${
                selectedSizeId === null ? "border-accent" : "border-[#1e1e1e] hover:border-[#333]"
              }`}
            >
              <div className="text-xs text-[#6b6b6b] mb-1">All Sizes</div>
              <div className="text-lg font-semibold tabular-nums text-white">
                {bannerSummary.reduce((sum, s) => sum + s.count, 0)}
              </div>
            </button>
            {bannerSummary.map((s) => (
              <button
                key={s.banner_size_id}
                onClick={() => { setSelectedSizeId(s.banner_size_id); setBannersPage(1); }}
                className={`bg-[#141414] rounded-lg border p-3 text-left transition-colors ${
                  selectedSizeId === s.banner_size_id ? "border-accent" : "border-[#1e1e1e] hover:border-[#333]"
                }`}
              >
                <div className="text-xs text-[#6b6b6b] mb-1">
                  {s.width}x{s.height} {s.label && `(${s.label})`}
                </div>
                <div className="text-lg font-semibold tabular-nums text-white">{s.count}</div>
              </button>
            ))}
          </div>

          {/* Banner list */}
          {bannersLoading ? (
            <div className="flex items-center justify-center py-10">
              <span className="text-[#6b6b6b] text-sm">Loading banners...</span>
            </div>
          ) : banners.length === 0 ? (
            <div className="flex items-center justify-center py-10">
              <span className="text-[#6b6b6b] text-sm">No banners yet. Click &quot;Generate Banners&quot; to create them.</span>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
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
                      <div className="text-xs text-white truncate mb-1">
                        {b.video_title || `Video #${b.video_id}`}
                      </div>
                      <div className="flex items-center justify-between">
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
              {bannersTotalPages > 1 && (
                <div className="flex items-center justify-center gap-2 pt-2">
                  <button
                    onClick={() => { setBannersPage((p) => Math.max(1, p - 1)); loadBanners(selectedSizeId, bannersPage - 1); }}
                    disabled={bannersPage <= 1}
                    className="px-3 py-1.5 text-sm rounded-lg bg-[#1e1e1e] text-[#a0a0a0] hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Prev
                  </button>
                  <span className="text-sm text-[#6b6b6b]">
                    {bannersPage} / {bannersTotalPages}
                  </span>
                  <button
                    onClick={() => { setBannersPage((p) => Math.min(bannersTotalPages, p + 1)); loadBanners(selectedSizeId, bannersPage + 1); }}
                    disabled={bannersPage >= bannersTotalPages}
                    className="px-3 py-1.5 text-sm rounded-lg bg-[#1e1e1e] text-[#a0a0a0] hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function InfoCard({
  label,
  value,
  alert,
}: {
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <div className="bg-[#141414] rounded-lg border border-[#1e1e1e] p-3">
      <div className="text-xs text-[#6b6b6b] mb-1">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${alert ? "text-red-400" : "text-white"}`}>
        {value}
      </div>
    </div>
  );
}

export default function AccountProfilePage() {
  return (
    <ToastProvider>
      <AccountProfileContent />
    </ToastProvider>
  );
}
