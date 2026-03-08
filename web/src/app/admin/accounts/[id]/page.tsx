"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Cropper from "react-easy-crop";
import type { Area } from "react-easy-crop";
import {
  getAdminAccount,
  updateAdminAccount,
  reparseAccount,
  getAccountBannerSummary,
  getAccountBanners,
  generateAccountBanners,
  deactivateBanner,
  batchDeactivateBanners,
  batchRegenerateBanners,
  recropBanner,
  getAccountStats,
  getAccountConversionPrices,
  upsertAccountConversionPrice,
  getAdSources,
  getAccountSourceEventIDs,
  upsertAccountSourceEventID,
} from "@/lib/admin-api";
import type {
  AdminAccount,
  BannerSizeSummary,
  AdminBanner,
  AccountDayStat,
  AccountConversionPrice,
  AdSource,
  AccountSourceEventID,
} from "@/lib/admin-api";
import { ToastProvider, useToast } from "../../Toast";

const CONVERSION_EVENTS = [
  { key: "social_click", label: "Social Click (fansite)" },
  { key: "content_click", label: "Content Click (IG/Twitter)" },
] as const;

const FAN_SITES = [
  { key: "onlyfans", label: "OnlyFans", placeholder: "username or full URL", color: "#00AFF0" },
  { key: "fansly", label: "Fansly", placeholder: "username or full URL", color: "#1FA7F2" },
  { key: "chaturbate", label: "Chaturbate", placeholder: "username or full URL", color: "#F69522" },
  { key: "manyvids", label: "ManyVids", placeholder: "username or full URL", color: "#FF4081" },
  { key: "stripchat", label: "Stripchat", placeholder: "username or full URL", color: "#C23B6E" },
] as const;

type Tab = "stats" | "links" | "promo";

function AccountProfileContent() {
  const params = useParams();
  const router = useRouter();
  const id = Number(params.id);
  const [account, setAccount] = useState<AdminAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<Tab>("stats");
  const { toast } = useToast();

  // Promo state
  const [bannerSummary, setBannerSummary] = useState<BannerSizeSummary[]>([]);
  const [banners, setBanners] = useState<AdminBanner[]>([]);
  const [selectedSizeId, setSelectedSizeId] = useState<number | null>(null);
  const [bannersLoading, setBannersLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [selectedBannerIds, setSelectedBannerIds] = useState<Set<number>>(new Set());
  const [bannerStyle, setBannerStyle] = useState<string>("bold");
  const [batchActionLoading, setBatchActionLoading] = useState(false);

  // Conversion price state
  const [conversionPrices, setConversionPrices] = useState<AccountConversionPrice[]>([]);
  const [convPriceInputs, setConvPriceInputs] = useState<Record<string, string>>({});
  const [convPriceSaving, setConvPriceSaving] = useState<string | null>(null);

  // Source event IDs state
  const [adSources, setAdSources] = useState<AdSource[]>([]);
  const [sourceEventIDs, setSourceEventIDs] = useState<AccountSourceEventID[]>([]);
  // Key: "sourceId:eventType", value: event_id string
  const [srcEventIdInputs, setSrcEventIdInputs] = useState<Record<string, string>>({});
  const [srcEventIdSaving, setSrcEventIdSaving] = useState<string | null>(null);

  // Crop modal state
  const [cropBanner, setCropBanner] = useState<AdminBanner | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [cropSaving, setCropSaving] = useState(false);

  // Stats state
  const [statsData, setStatsData] = useState<AccountDayStat[]>([]);
  const [statsSummary, setStatsSummary] = useState<AccountDayStat | null>(null);
  const [statsDays, setStatsDays] = useState(30);
  const [statsLoading, setStatsLoading] = useState(false);

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
  const loadConversionPrices = useCallback(async () => {
    try {
      const prices = await getAccountConversionPrices(id);
      setConversionPrices(prices);
      const priceInputs: Record<string, string> = {};
      for (const p of prices) {
        priceInputs[p.event_type] = String(p.price);
      }
      setConvPriceInputs((prev) => ({ ...prev, ...priceInputs }));
    } catch {
      // silent
    }
  }, [id]);

  const loadSourceEventIDs = useCallback(async () => {
    try {
      const [sources, items] = await Promise.all([
        getAdSources(),
        getAccountSourceEventIDs(id),
      ]);
      setAdSources(sources.filter((s) => s.is_active));
      setSourceEventIDs(items);
      const inputs: Record<string, string> = {};
      for (const item of items) {
        inputs[`${item.ad_source_id}:${item.event_type}`] = String(item.event_id);
      }
      setSrcEventIdInputs((prev) => ({ ...prev, ...inputs }));
    } catch {
      // silent
    }
  }, [id]);

  const loadBannerSummary = useCallback(async () => {
    try {
      const summary = await getAccountBannerSummary(id);
      setBannerSummary(summary);
    } catch {
      // silent — table may not exist yet
    }
  }, [id]);

  const loadBanners = useCallback(async (sizeId: number | null) => {
    setBannersLoading(true);
    try {
      const result = await getAccountBanners(id, {
        size_id: sizeId ?? undefined,
        page: 1,
        per_page: 1000,
      });
      setBanners(result.banners);
    } catch {
      setBanners([]);
    } finally {
      setBannersLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (activeTab === "promo") {
      loadBannerSummary();
      loadBanners(selectedSizeId);
      loadConversionPrices();
      loadSourceEventIDs();
      setSelectedBannerIds(new Set());
    }
  }, [activeTab, loadBannerSummary, loadBanners, loadConversionPrices, loadSourceEventIDs, selectedSizeId]);

  // Load stats when stats tab is active or period changes.
  const loadStats = useCallback(async (d: number) => {
    setStatsLoading(true);
    try {
      const result = await getAccountStats(id, d);
      setStatsData(result.stats);
      setStatsSummary(result.summary);
    } catch {
      // silent
    } finally {
      setStatsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (activeTab === "stats") {
      loadStats(statsDays);
    }
  }, [activeTab, statsDays, loadStats]);

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

  const handleDeactivateBanner = async (bannerId: number) => {
    if (!confirm("Deactivate this banner? It won't be recreated on next generation.")) return;
    try {
      await deactivateBanner(bannerId);
      setBanners((prev) => prev.filter((b) => b.id !== bannerId));
      setSelectedBannerIds((prev) => { const next = new Set(prev); next.delete(bannerId); return next; });
      toast("Banner deactivated");
      loadBannerSummary();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to deactivate", "error");
    }
  };

  const handleRegenerateBanner = async (bannerId: number) => {
    try {
      const result = await batchRegenerateBanners([bannerId]);
      toast(`Re-grab enqueued (${result.enqueued} job)`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to regenerate", "error");
    }
  };

  const handleBatchDeactivate = async () => {
    const ids = Array.from(selectedBannerIds);
    if (!confirm(`Deactivate ${ids.length} banner(s)?`)) return;
    setBatchActionLoading(true);
    try {
      const result = await batchDeactivateBanners(ids);
      setBanners((prev) => prev.filter((b) => !selectedBannerIds.has(b.id)));
      setSelectedBannerIds(new Set());
      toast(`${result.deactivated} banner(s) deactivated`);
      loadBannerSummary();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to deactivate", "error");
    } finally {
      setBatchActionLoading(false);
    }
  };

  const handleBatchRegenerate = async () => {
    const ids = Array.from(selectedBannerIds);
    setBatchActionLoading(true);
    try {
      const result = await batchRegenerateBanners(ids);
      toast(`Re-grab enqueued (${result.enqueued} job(s))`);
      setSelectedBannerIds(new Set());
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to regenerate", "error");
    } finally {
      setBatchActionLoading(false);
    }
  };

  const toggleBannerSelection = (id: number) => {
    setSelectedBannerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedBannerIds.size === banners.length) {
      setSelectedBannerIds(new Set());
    } else {
      setSelectedBannerIds(new Set(banners.map((b) => b.id)));
    }
  };

  const openCropModal = (banner: AdminBanner) => {
    if (!banner.source_image_url) {
      toast("No source image available for this banner", "error");
      return;
    }
    setCropBanner(banner);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
  };

  const handleCropComplete = useCallback((_: Area, croppedPixels: Area) => {
    setCroppedAreaPixels(croppedPixels);
  }, []);

  const handleCropSave = async () => {
    if (!cropBanner || !croppedAreaPixels) return;
    setCropSaving(true);
    try {
      const result = await recropBanner(cropBanner.id, {
        x: Math.round(croppedAreaPixels.x),
        y: Math.round(croppedAreaPixels.y),
        width: Math.round(croppedAreaPixels.width),
        height: Math.round(croppedAreaPixels.height),
      });
      setBanners((prev) =>
        prev.map((b) =>
          b.id === cropBanner.id ? { ...b, image_url: result.image_url } : b,
        ),
      );
      toast("Banner re-cropped successfully");
      setCropBanner(null);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to re-crop", "error");
    } finally {
      setCropSaving(false);
    }
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
          onClick={() => setActiveTab("stats")}
          className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
            activeTab === "stats"
              ? "border-accent text-white"
              : "border-transparent text-[#6b6b6b] hover:text-[#a0a0a0]"
          }`}
        >
          Stats
        </button>
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
      {activeTab === "stats" && (
        <div>
          {/* Period selector */}
          <div className="flex items-center gap-2 mb-4">
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                onClick={() => setStatsDays(d)}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  statsDays === d
                    ? "bg-accent text-white"
                    : "bg-[#1e1e1e] text-[#a0a0a0] hover:text-white hover:bg-[#252525]"
                }`}
              >
                {d}d
              </button>
            ))}
          </div>

          {statsLoading ? (
            <div className="flex items-center justify-center py-10">
              <span className="text-[#6b6b6b] text-sm">Loading...</span>
            </div>
          ) : (
            <>
              {/* Summary cards */}
              {statsSummary && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
                  {[
                    { label: "Profile Views", value: statsSummary.profile_views.toLocaleString() },
                    { label: "IG / Twitter", value: statsSummary.instagram_clicks.toLocaleString() },
                    { label: "Paid Sites", value: statsSummary.paid_site_clicks.toLocaleString() },
                    { label: "Video Clicks", value: statsSummary.video_clicks.toLocaleString() },
                    { label: "Sessions", value: statsSummary.unique_sessions.toLocaleString() },
                    { label: "Avg Duration", value: formatDuration(statsSummary.avg_session_sec) },
                  ].map((item) => (
                    <div key={item.label} className="bg-[#141414] rounded-lg border border-[#1e1e1e] p-3">
                      <div className="text-[10px] text-[#6b6b6b] mb-0.5">{item.label}</div>
                      <div className="text-lg font-bold text-white tabular-nums">{item.value}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Daily table */}
              {statsData.length > 0 ? (
                <div className="bg-[#141414] rounded-lg border border-[#1e1e1e] overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-[#6b6b6b] text-xs border-b border-[#1e1e1e]">
                          <th className="text-left px-4 py-2 font-medium">Date</th>
                          <th className="text-right px-4 py-2 font-medium">Profile Views</th>
                          <th className="text-right px-4 py-2 font-medium">IG / Twitter</th>
                          <th className="text-right px-4 py-2 font-medium">Paid Sites</th>
                          <th className="text-right px-4 py-2 font-medium">Video Clicks</th>
                          <th className="text-right px-4 py-2 font-medium">Sessions</th>
                          <th className="text-right px-4 py-2 font-medium">Avg Duration</th>
                        </tr>
                      </thead>
                      <tbody>
                        {statsData.map((row) => (
                          <tr key={row.date} className="border-b border-[#1e1e1e] last:border-b-0 hover:bg-[#1a1a1a] transition-colors">
                            <td className="px-4 py-2.5 text-white font-medium">{row.date}</td>
                            <td className="px-4 py-2.5 text-right text-[#a0a0a0]">{row.profile_views.toLocaleString()}</td>
                            <td className="px-4 py-2.5 text-right text-[#a0a0a0]">{row.instagram_clicks.toLocaleString()}</td>
                            <td className="px-4 py-2.5 text-right text-white font-medium">{row.paid_site_clicks.toLocaleString()}</td>
                            <td className="px-4 py-2.5 text-right text-[#a0a0a0]">{row.video_clicks.toLocaleString()}</td>
                            <td className="px-4 py-2.5 text-right text-[#a0a0a0]">{row.unique_sessions.toLocaleString()}</td>
                            <td className="px-4 py-2.5 text-right text-[#a0a0a0]">{formatDuration(row.avg_session_sec)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center py-10">
                  <span className="text-[#6b6b6b] text-sm">No stats data for this period</span>
                </div>
              )}
            </>
          )}
        </div>
      )}

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
          {/* Conversion Prices (CPA per model) */}
          <div>
            <h2 className="text-sm font-semibold text-white mb-2">Conversion Prices</h2>
            <div className="bg-[#141414] rounded-lg border border-[#1e1e1e] p-4 space-y-3">
              {CONVERSION_EVENTS.map((evt) => {
                const existing = conversionPrices.find((p) => p.event_type === evt.key);
                return (
                  <div key={evt.key} className="flex items-center gap-3">
                    <div className="w-52 shrink-0">
                      <span className="text-sm text-[#a0a0a0]">{evt.label}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-[#6b6b6b]">$</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={convPriceInputs[evt.key] ?? ""}
                        onChange={(e) =>
                          setConvPriceInputs((prev) => ({ ...prev, [evt.key]: e.target.value }))
                        }
                        placeholder="0.00"
                        className="w-28 px-3 py-1.5 text-sm rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-white placeholder-[#4a4a4a] focus:outline-none focus:border-accent transition-colors tabular-nums"
                      />
                    </div>
                    <button
                      onClick={async () => {
                        const price = parseFloat(convPriceInputs[evt.key] || "0");
                        if (isNaN(price) || price < 0) return;
                        setConvPriceSaving(evt.key);
                        try {
                          await upsertAccountConversionPrice(id, { event_type: evt.key, price });
                          await loadConversionPrices();
                          toast("Saved", "success");
                        } catch {
                          toast("Failed to save", "error");
                        } finally {
                          setConvPriceSaving(null);
                        }
                      }}
                      disabled={convPriceSaving === evt.key}
                      className="px-3 py-1.5 text-xs rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-40 transition-colors"
                    >
                      {convPriceSaving === evt.key ? "..." : "Save"}
                    </button>
                    {existing && (
                      <span className="text-xs text-[#4a4a4a]">
                        set {new Date(existing.updated_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                );
              })}
              <p className="text-xs text-[#4a4a4a] mt-2">
                CPA price per conversion type, sent as {"{cpa}"} in postback URL.
              </p>
            </div>
          </div>

          {/* Event IDs per Source */}
          {adSources.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-white mb-2">Event IDs per Source</h2>
              <div className="bg-[#141414] rounded-lg border border-[#1e1e1e] p-4 space-y-4">
                {adSources.map((src) => (
                  <div key={src.id}>
                    <div className="text-sm text-accent mb-2">{src.name}</div>
                    <div className="space-y-2">
                      {CONVERSION_EVENTS.map((evt) => {
                        const inputKey = `${src.id}:${evt.key}`;
                        const existing = sourceEventIDs.find(
                          (s) => s.ad_source_id === src.id && s.event_type === evt.key,
                        );
                        return (
                          <div key={inputKey} className="flex items-center gap-3">
                            <div className="w-48 shrink-0">
                              <span className="text-sm text-[#a0a0a0]">{evt.label}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-[#6b6b6b]">#</span>
                              <input
                                type="number"
                                min="1"
                                max="9"
                                value={srcEventIdInputs[inputKey] ?? "1"}
                                onChange={(e) =>
                                  setSrcEventIdInputs((prev) => ({ ...prev, [inputKey]: e.target.value }))
                                }
                                className="w-14 px-2 py-1.5 text-sm rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-white focus:outline-none focus:border-accent transition-colors tabular-nums text-center"
                              />
                            </div>
                            <button
                              onClick={async () => {
                                const eventId = parseInt(srcEventIdInputs[inputKey] || "1", 10);
                                if (isNaN(eventId) || eventId < 1 || eventId > 9) return;
                                setSrcEventIdSaving(inputKey);
                                try {
                                  await upsertAccountSourceEventID(id, {
                                    ad_source_id: src.id,
                                    event_type: evt.key,
                                    event_id: eventId,
                                  });
                                  await loadSourceEventIDs();
                                  toast("Saved", "success");
                                } catch {
                                  toast("Failed to save", "error");
                                } finally {
                                  setSrcEventIdSaving(null);
                                }
                              }}
                              disabled={srcEventIdSaving === inputKey}
                              className="px-3 py-1.5 text-xs rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-40 transition-colors"
                            >
                              {srcEventIdSaving === inputKey ? "..." : "Save"}
                            </button>
                            {existing && (
                              <span className="text-xs text-[#4a4a4a]">
                                set {new Date(existing.updated_at).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <p className="text-xs text-[#4a4a4a] mt-2">
                  Event ID (1-9) per source, sent as {"{event_id}"} in postback URL.
                </p>
              </div>
            </div>
          )}

          {/* Toolbar: generate + style selector */}
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-white">Banners</h2>
            <div className="flex items-center gap-2">
              <select
                value={bannerStyle}
                onChange={(e) => setBannerStyle(e.target.value)}
                className="px-2 py-1.5 text-xs rounded-lg bg-[#1e1e1e] border border-[#2a2a2a] text-[#a0a0a0] focus:outline-none focus:border-accent"
              >
                <option value="static">Static</option>
                <option value="bold">Bold</option>
                <option value="elegant">Elegant</option>
                <option value="minimalist">Minimalist</option>
                <option value="card">Card</option>
              </select>
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="px-3 py-1.5 text-sm rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {generating ? "Generating..." : "Generate Banners"}
              </button>
            </div>
          </div>

          {/* Banner size summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <button
              onClick={() => setSelectedSizeId(null)}
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
                onClick={() => setSelectedSizeId(s.banner_size_id)}
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

          {/* Select all + mass action bar */}
          {banners.length > 0 && (
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer text-xs text-[#6b6b6b] hover:text-[#a0a0a0] transition-colors">
                <input
                  type="checkbox"
                  checked={banners.length > 0 && selectedBannerIds.size === banners.length}
                  onChange={toggleSelectAll}
                  className="accent-accent w-3.5 h-3.5"
                />
                Select all ({banners.length})
              </label>
              {selectedBannerIds.size > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[#6b6b6b]">{selectedBannerIds.size} selected</span>
                  <button
                    onClick={handleBatchRegenerate}
                    disabled={batchActionLoading}
                    className="px-2.5 py-1 text-xs rounded-lg bg-[#1e1e1e] text-[#a0a0a0] hover:text-accent hover:bg-[#252525] disabled:opacity-40 transition-colors"
                  >
                    Re-grab
                  </button>
                  <button
                    onClick={handleBatchDeactivate}
                    disabled={batchActionLoading}
                    className="px-2.5 py-1 text-xs rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-40 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          )}

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
            <div className="flex flex-wrap gap-4">
              {banners.map((b) => (
                <div
                  key={b.id}
                  className={`bg-[#141414] rounded-lg border overflow-hidden transition-colors ${
                    selectedBannerIds.has(b.id) ? "border-accent" : "border-[#1e1e1e]"
                  }`}
                >
                  <div className="relative group">
                    <input
                      type="checkbox"
                      checked={selectedBannerIds.has(b.id)}
                      onChange={() => toggleBannerSelection(b.id)}
                      className="absolute top-2 left-2 accent-accent w-4 h-4 z-20 cursor-pointer"
                    />
                    {bannerStyle === "static" ? (
                      <img
                        src={`${b.image_url}&_t=${Date.now()}`}
                        alt={b.video_title}
                        width={b.width}
                        height={b.height}
                        style={{ width: b.width, height: b.height }}
                        className="block"
                      />
                    ) : (
                      <iframe
                        src={`/b/${b.id}/preview?style=${bannerStyle}&_t=${Date.now()}`}
                        width={b.width}
                        height={b.height}
                        style={{ width: b.width, height: b.height, border: "none" }}
                        loading="lazy"
                        title={`Banner ${b.id} preview`}
                      />
                    )}
                    {/* Overlay actions — visible on hover */}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-all z-10 flex items-center justify-center gap-3 opacity-0 group-hover:opacity-100">
                      <button
                        onClick={() => handleCopyUrl(b.image_url)}
                        className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center text-white hover:bg-white/40 transition-colors"
                        title="Copy URL"
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                      </button>
                      <button
                        onClick={() => openCropModal(b)}
                        className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center text-white hover:bg-white/40 transition-colors"
                        title="Re-crop"
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M6 2v14a2 2 0 0 0 2 2h14" />
                          <path d="M18 22V8a2 2 0 0 0-2-2H2" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleRegenerateBanner(b.id)}
                        className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center text-white hover:bg-white/40 transition-colors"
                        title="Re-grab"
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="23 4 23 10 17 10" />
                          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDeactivateBanner(b.id)}
                        className="w-10 h-10 rounded-full bg-red-500/30 backdrop-blur-sm flex items-center justify-center text-white hover:bg-red-500/50 transition-colors"
                        title="Delete"
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <div className="p-3" style={{ width: Math.max(b.width + 16, 200) }}>
                    <div className="text-xs text-white truncate mb-1">
                      {b.video_title || `Video #${b.video_id}`}
                    </div>
                    <div className="text-[10px] text-[#6b6b6b] mb-0.5">
                      Imprs: {b.impressions || 0} &nbsp;|&nbsp; Clicks: {b.clicks || 0} &nbsp;|&nbsp; CTR: {b.ctr || 0}%
                    </div>
                    <div className="text-[10px] text-[#6b6b6b]">
                      {b.width}x{b.height}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Crop Modal */}
      {cropBanner && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
          <div className="bg-[#1a1a1a] rounded-xl border border-[#2a2a2a] w-[90vw] max-w-3xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-[#2a2a2a]">
              <div>
                <h3 className="text-sm font-medium text-white">Re-crop Banner</h3>
                <p className="text-xs text-[#6b6b6b] mt-0.5">
                  {cropBanner.width}x{cropBanner.height} &mdash; {cropBanner.video_title || `Video #${cropBanner.video_id}`}
                </p>
              </div>
              <button
                onClick={() => setCropBanner(null)}
                className="text-[#6b6b6b] hover:text-white transition-colors text-lg leading-none"
              >
                &times;
              </button>
            </div>
            <div className="relative flex-1 min-h-[400px]">
              <Cropper
                image={`${cropBanner.source_image_url}${cropBanner.source_image_url?.includes('?') ? '&' : '?'}_t=${Date.now()}`}
                crop={crop}
                zoom={zoom}
                aspect={cropBanner.width / cropBanner.height}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={handleCropComplete}
              />
            </div>
            <div className="p-4 border-t border-[#2a2a2a] flex items-center gap-4">
              <label className="text-xs text-[#6b6b6b]">Zoom</label>
              <input
                type="range"
                min={1}
                max={3}
                step={0.1}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="flex-1 accent-accent"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => setCropBanner(null)}
                  className="px-4 py-1.5 text-xs text-[#6b6b6b] border border-[#2a2a2a] rounded hover:border-[#3a3a3a] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCropSave}
                  disabled={cropSaving || !croppedAreaPixels}
                  className="px-4 py-1.5 text-xs text-white bg-accent rounded hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {cropSaving ? "Saving..." : "Save Crop"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds < 1) return "0s";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
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
