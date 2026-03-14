"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getAdminSite, updateAdminSite } from "@/lib/admin-api";
import type { AdminSite, SiteConfig } from "@/lib/admin-api";
import { ToastProvider, useToast } from "../../Toast";

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
            Activate with <code className="font-mono text-[#aaa]">NEXT_PUBLIC_TEMPLATE</code> env var.
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
  );
}
