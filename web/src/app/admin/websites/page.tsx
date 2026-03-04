"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getAdminSites, refreshSiteContent } from "@/lib/admin-api";
import type { AdminSite } from "@/lib/admin-api";
import { ToastProvider, useToast } from "../Toast";

export default function WebsitesPage() {
  return (
    <ToastProvider>
      <WebsitesContent />
    </ToastProvider>
  );
}

function WebsitesContent() {
  const router = useRouter();
  const [sites, setSites] = useState<AdminSite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshingId, setRefreshingId] = useState<number | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const load = async () => {
      try {
        const data = await getAdminSites();
        setSites(data);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load websites",
        );
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const handleRefresh = async (site: AdminSite) => {
    setRefreshingId(site.id);
    try {
      const result = await refreshSiteContent(site.id);
      toast(
        `Enqueued ${result.enqueued} account(s) for reparse. Cache invalidated for ${site.domain}.`,
        "success",
      );
    } catch (err) {
      toast(
        err instanceof Error ? err.message : "Failed to refresh content",
        "error",
      );
    } finally {
      setRefreshingId(null);
    }
  };

  const totalVideos = sites.reduce((sum, s) => sum + s.video_count, 0);
  const totalCategories = sites.reduce((sum, s) => sum + s.category_count, 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-white">Websites</h1>
        <span className="text-sm text-[#6b6b6b]">
          {sites.length} site(s), {totalVideos.toLocaleString()} videos,{" "}
          {totalCategories} categories
        </span>
      </div>

      {error ? (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-red-400 text-sm">
          {error}
        </div>
      ) : (
        <div className="bg-[#141414] rounded-lg border border-[#1e1e1e] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1e1e1e]">
                  <th className="text-left px-4 py-3 text-[#6b6b6b] font-medium">
                    Domain
                  </th>
                  <th className="text-left px-4 py-3 text-[#6b6b6b] font-medium">
                    Name
                  </th>
                  <th className="text-right px-4 py-3 text-[#6b6b6b] font-medium">
                    Videos
                  </th>
                  <th className="text-right px-4 py-3 text-[#6b6b6b] font-medium">
                    Categories
                  </th>
                  <th className="text-center px-4 py-3 text-[#6b6b6b] font-medium">
                    Status
                  </th>
                  <th className="text-right px-4 py-3 text-[#6b6b6b] font-medium">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-8 text-center text-[#6b6b6b]"
                    >
                      Loading...
                    </td>
                  </tr>
                ) : sites.length > 0 ? (
                  sites.map((site) => (
                    <tr
                      key={site.id}
                      className="border-b border-[#1e1e1e] hover:bg-[#1a1a1a] transition-colors"
                    >
                      <td className="px-4 py-3">
                        <button
                          onClick={() => router.push(`/admin/websites/${site.id}`)}
                          className="text-white font-medium font-mono text-xs hover:text-accent transition-colors"
                        >
                          {site.domain}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-[#a0a0a0]">
                        {site.name}
                      </td>
                      <td className="px-4 py-3 text-right text-white tabular-nums">
                        {site.video_count.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right text-white tabular-nums">
                        {site.category_count}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                            site.is_active
                              ? "bg-green-500/10 text-green-400"
                              : "bg-red-500/10 text-red-400"
                          }`}
                        >
                          {site.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => handleRefresh(site)}
                          disabled={refreshingId !== null}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-accent/10 text-accent hover:bg-accent/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          {refreshingId === site.id ? (
                            <>
                              <svg
                                className="w-3.5 h-3.5 animate-spin"
                                viewBox="0 0 24 24"
                                fill="none"
                              >
                                <circle
                                  cx="12"
                                  cy="12"
                                  r="10"
                                  stroke="currentColor"
                                  strokeWidth="3"
                                  strokeDasharray="31.4 31.4"
                                  strokeLinecap="round"
                                />
                              </svg>
                              Refreshing...
                            </>
                          ) : (
                            <>
                              <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <polyline points="23 4 23 10 17 10" />
                                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                              </svg>
                              Refresh Content
                            </>
                          )}
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-8 text-center text-[#6b6b6b]"
                    >
                      No websites found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
