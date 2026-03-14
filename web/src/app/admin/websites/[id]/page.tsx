"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  getAdminSite,
  updateAdminSite,
  getAdminCategories,
  getBannerSizes,
} from "@/lib/admin-api";
import type { AdminSite, SiteConfig, AdminCategory, BannerSize } from "@/lib/admin-api";
import { ToastProvider, useToast } from "../../Toast";

type SiteTab = "settings" | "content" | "banners";

export default function SiteSettingsPage() {
  return (
    <ToastProvider>
      <SiteSettingsContent />
    </ToastProvider>
  );
}

function SiteSettingsContent() {
  const params = useParams();
  const router = useRouter();
  const id = Number(params.id);
  const [site, setSite] = useState<AdminSite | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [config, setConfig] = useState<SiteConfig>({});
  const [tab, setTab] = useState<SiteTab>("settings");
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [bannerSizes, setBannerSizes] = useState<BannerSize[]>([]);
  const [tabDataLoaded, setTabDataLoaded] = useState<Partial<Record<SiteTab, boolean>>>({});
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const load = async () => {
      try {
        const data = await getAdminSite(id);
        setSite(data);
        setConfig(data.config || {});
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load site");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  // Load tab-specific data on demand
  useEffect(() => {
    if (tab === "content" && !tabDataLoaded.content) {
      setTabDataLoaded((prev) => ({ ...prev, content: true }));
      getAdminCategories()
        .then(setCategories)
        .catch((err) =>
          toast(err instanceof Error ? err.message : "Failed to load categories", "error")
        );
    }
    if (tab === "banners" && !tabDataLoaded.banners) {
      setTabDataLoaded((prev) => ({ ...prev, banners: true }));
      getBannerSizes()
        .then(setBannerSizes)
        .catch((err) =>
          toast(err instanceof Error ? err.message : "Failed to load banner sizes", "error")
        );
    }
  }, [tab, tabDataLoaded, toast]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await updateAdminSite(id, { config });
      setSite(updated);
      setConfig(updated.config || {});
      toast("Settings saved", "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleCopyEmbed = (size: BannerSize) => {
    const domain = site?.domain ?? "temptguide.com";
    const embedCode = `<script src="https://${domain}/banner.js?size=${size.id}" async></script>`;
    navigator.clipboard.writeText(embedCode).then(() => {
      setCopiedId(size.id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-[#6b6b6b]">
        Loading...
      </div>
    );
  }

  if (error || !site) {
    return (
      <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-red-400 text-sm">
        {error || "Site not found"}
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => router.push("/admin/websites")}
          className="text-[#6b6b6b] hover:text-white transition-colors"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div>
          <h1 className="text-xl font-bold text-white">{site.name}</h1>
          <p className="text-sm text-[#6b6b6b] font-mono">{site.domain}</p>
        </div>
        <span
          className={`ml-2 inline-block px-2 py-0.5 rounded text-xs font-medium ${
            site.is_active
              ? "bg-green-500/10 text-green-400"
              : "bg-red-500/10 text-red-400"
          }`}
        >
          {site.is_active ? "Active" : "Inactive"}
        </span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[#1e1e1e] mb-6">
        {(["settings", "content", "banners"] as SiteTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors capitalize ${
              tab === t
                ? "border-accent text-accent"
                : "border-transparent text-[#6b6b6b] hover:text-white"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Settings Tab */}
      {tab === "settings" && (
        <div>
          {/* Site Info */}
          <div className="bg-[#141414] rounded-lg border border-[#1e1e1e] p-4 mb-4">
            <h2 className="text-sm font-medium text-[#6b6b6b] mb-3">Site Info</h2>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-[#6b6b6b]">Slug:</span>{" "}
                <span className="text-white font-mono">{site.slug}</span>
              </div>
              <div>
                <span className="text-[#6b6b6b]">Domain:</span>{" "}
                <span className="text-white font-mono">{site.domain}</span>
              </div>
              <div>
                <span className="text-[#6b6b6b]">Videos:</span>{" "}
                <span className="text-white">{site.video_count.toLocaleString()}</span>
              </div>
              <div>
                <span className="text-[#6b6b6b]">Categories:</span>{" "}
                <span className="text-white">{site.category_count}</span>
              </div>
            </div>
          </div>

          {/* Display Settings */}
          <div className="bg-[#141414] rounded-lg border border-[#1e1e1e] p-4 mb-6">
            <h2 className="text-sm font-medium text-[#6b6b6b] mb-4">
              Display Settings
            </h2>

            {/* Template selector */}
            <div className="mb-4">
              <label className="block text-sm text-white mb-1">Template</label>
              <p className="text-xs text-[#6b6b6b] mb-2">
                UI kit for this site. Add new templates in{" "}
                <code className="font-mono text-[#aaa]">web/src/templates/</code> and register in{" "}
                <code className="font-mono text-[#aaa]">_shared/registry.ts</code>.
                Select and save — takes effect within 5 minutes, no rebuild needed.
              </p>
              <select
                value={config.template || "default"}
                onChange={(e) =>
                  setConfig((prev) => ({ ...prev, template: e.target.value }))
                }
                className="w-full bg-[#1e1e1e] border border-[#2e2e2e] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent"
              >
                <option value="default">default — Instagram-style dark feed</option>
              </select>
            </div>

            <label className="flex items-center justify-between cursor-pointer group">
              <div>
                <div className="text-sm text-white group-hover:text-accent transition-colors">
                  Show social buttons on model profiles
                </div>
                <div className="text-xs text-[#6b6b6b] mt-0.5">
                  Instagram, OnlyFans, Fansly buttons on /model/[slug] pages
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={config.show_social_buttons !== false}
                onClick={() =>
                  setConfig((prev) => ({
                    ...prev,
                    show_social_buttons: prev.show_social_buttons === false,
                  }))
                }
                className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                  config.show_social_buttons !== false
                    ? "bg-accent"
                    : "bg-[#333]"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform ${
                    config.show_social_buttons !== false
                      ? "translate-x-5"
                      : "translate-x-0"
                  }`}
                />
              </button>
            </label>
          </div>

          {/* Save */}
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-accent text-white hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? "Saving..." : "Save Settings"}
          </button>
        </div>
      )}

      {/* Content Tab */}
      {tab === "content" && (
        <div>
          <p className="text-sm text-[#6b6b6b] mb-4">
            Categories available across this site. Per-site category enable/disable controls
            are not yet implemented — all active categories are currently shown on every site.
          </p>
          {categories.length === 0 ? (
            <div className="bg-[#141414] rounded-lg border border-[#1e1e1e] p-8 text-center text-[#6b6b6b] text-sm">
              Loading categories...
            </div>
          ) : (
            <div className="bg-[#141414] rounded-lg border border-[#1e1e1e] overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#1e1e1e]">
                    <th className="text-left px-4 py-3 text-[#6b6b6b] font-medium">Category</th>
                    <th className="text-left px-4 py-3 text-[#6b6b6b] font-medium">Slug</th>
                    <th className="text-right px-4 py-3 text-[#6b6b6b] font-medium">Videos</th>
                    <th className="text-center px-4 py-3 text-[#6b6b6b] font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {categories.map((cat) => (
                    <tr key={cat.id} className="border-b border-[#1e1e1e] last:border-0">
                      <td className="px-4 py-3 text-white">{cat.name}</td>
                      <td className="px-4 py-3 text-[#6b6b6b] font-mono text-xs">{cat.slug}</td>
                      <td className="px-4 py-3 text-right text-[#a0a0a0] tabular-nums">
                        {cat.video_count.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                            cat.is_active
                              ? "bg-green-500/10 text-green-400"
                              : "bg-[#2a2a2a] text-[#6b6b6b]"
                          }`}
                        >
                          {cat.is_active ? "Active" : "Disabled"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {/* TODO: add per-site category enable/disable toggle via API */}
        </div>
      )}

      {/* Banners Tab */}
      {tab === "banners" && (
        <div>
          <p className="text-sm text-[#6b6b6b] mb-4">
            Banner sizes and their embed codes for <span className="font-mono text-white">{site.domain}</span>.
            Paste the embed code into the page where you want the banner to appear.
          </p>
          {bannerSizes.length === 0 ? (
            <div className="bg-[#141414] rounded-lg border border-[#1e1e1e] p-8 text-center text-[#6b6b6b] text-sm">
              Loading banner sizes...
            </div>
          ) : (
            <div className="space-y-3">
              {bannerSizes.map((size) => {
                const embedCode = `<script src="https://${site.domain}/banner.js?size=${size.id}" async></script>`;
                return (
                  <div
                    key={size.id}
                    className="bg-[#141414] rounded-lg border border-[#1e1e1e] p-4"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <span className="text-white font-medium">{size.label}</span>
                        <span className="text-[#6b6b6b] text-xs tabular-nums">
                          {size.width} × {size.height}
                        </span>
                        <span className="text-[#6b6b6b] text-xs capitalize">{size.type}</span>
                        <span
                          className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${
                            size.is_active
                              ? "bg-green-500/10 text-green-400"
                              : "bg-[#2a2a2a] text-[#6b6b6b]"
                          }`}
                        >
                          {size.is_active ? "Active" : "Inactive"}
                        </span>
                      </div>
                      <button
                        onClick={() => handleCopyEmbed(size)}
                        className="px-3 py-1.5 text-xs font-medium rounded-md bg-[#1e1e1e] text-[#a0a0a0] hover:text-white hover:bg-[#2a2a2a] transition-colors"
                      >
                        {copiedId === size.id ? "Copied!" : "Copy"}
                      </button>
                    </div>
                    <code className="block text-xs text-[#6b6b6b] bg-[#0a0a0a] rounded px-3 py-2 font-mono break-all">
                      {embedCode}
                    </code>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
