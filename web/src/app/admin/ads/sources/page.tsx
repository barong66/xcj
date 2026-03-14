"use client";

import { useEffect, useState, useCallback } from "react";
import {
  getAdSources,
  createAdSource,
  updateAdSource,
} from "@/lib/admin-api";
import type { AdSource } from "@/lib/admin-api";
import { ToastProvider, useToast } from "../../Toast";

// ─── Sources Content ──────────────────────────────────────────────────────────

function SourcesContent() {
  const [sources, setSources] = useState<AdSource[]>([]);
  const [showAddSource, setShowAddSource] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const loadSources = useCallback(async () => {
    try {
      setSources(await getAdSources());
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to load sources", "error");
    }
  }, [toast]);

  useEffect(() => {
    loadSources();
  }, [loadSources]);

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
      loadSources();
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
      loadSources();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update", "error");
    }
  };

  return (
    <div>
      <h1 className="text-lg font-bold text-white mb-6">Ad Sources</h1>

      {/* Ad Sources section */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-white">Sources</h2>
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

export default function SourcesPage() {
  return (
    <ToastProvider>
      <SourcesContent />
    </ToastProvider>
  );
}
