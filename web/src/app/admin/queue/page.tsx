"use client";

import { useEffect, useState, useCallback } from "react";
import {
  getAdminQueue,
  getQueueSummary,
  retryFailedJobs,
  clearFailedJobs,
  cancelQueueItem,
} from "@/lib/admin-api";
import type { AdminQueueList, QueueSummary } from "@/lib/admin-api";
import { ToastProvider, useToast } from "../Toast";

const STATUS_TABS = [
  { label: "All", value: "" },
  { label: "Pending", value: "pending" },
  { label: "Running", value: "running" },
  { label: "Done", value: "done" },
  { label: "Failed", value: "failed" },
];

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 0) return "just now";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ${min % 60}m ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

function QueueContent() {
  const [data, setData] = useState<AdminQueueList | null>(null);
  const [summary, setSummary] = useState<QueueSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const { toast } = useToast();

  const loadQueue = useCallback(async () => {
    try {
      setLoading(true);
      const [result, sum] = await Promise.all([
        getAdminQueue({
          status: statusFilter || undefined,
          page,
          per_page: 20,
        }),
        getQueueSummary(),
      ]);
      setData(result);
      setSummary(sum);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to load queue", "error");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, page, toast]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  const handleRetryFailed = async () => {
    try {
      const result = await retryFailedJobs();
      toast(`Retried ${result.retried} failed jobs`);
      loadQueue();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to retry", "error");
    }
  };

  const handleClearFailed = async () => {
    if (!confirm("Clear all failed jobs?")) return;
    try {
      const result = await clearFailedJobs();
      toast(`Cleared ${result.cleared} failed jobs`);
      loadQueue();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to clear", "error");
    }
  };

  const handleCancel = async (id: number) => {
    try {
      await cancelQueueItem(id);
      toast("Job cancelled");
      loadQueue();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to cancel", "error");
    }
  };

  const workerRunning = summary?.worker_running ?? false;
  const workerOffline = summary
    ? !workerRunning && summary.pending > 0
    : false;

  // Compute position for pending items
  const pendingPositions = new Map<number, number>();
  if (data) {
    let pos = 1;
    for (const item of [...data.items].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    )) {
      if (item.status === "pending") {
        pendingPositions.set(item.id, pos++);
      }
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold text-white">Parse Queue</h1>
          {summary && (
            <div className="flex items-center gap-2 text-sm">
              {summary.pending > 0 && (
                <span className="px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400 tabular-nums">
                  {summary.pending} pending
                </span>
              )}
              {summary.running > 0 && (
                <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 tabular-nums">
                  {summary.running} running
                </span>
              )}
              {summary.failed > 0 && (
                <span className="px-2 py-0.5 rounded bg-red-500/10 text-red-400 tabular-nums">
                  {summary.failed} failed
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleRetryFailed}
            className="px-3 py-2 text-sm rounded-lg bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 transition-colors"
          >
            Retry Failed
          </button>
          <button
            onClick={handleClearFailed}
            className="px-3 py-2 text-sm rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
          >
            Clear Failed
          </button>
          <button
            onClick={loadQueue}
            className="px-3 py-2 text-sm rounded-lg bg-[#1e1e1e] text-[#a0a0a0] hover:text-white transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Worker status banner */}
      {workerRunning && summary && (summary.pending > 0 || summary.running > 0) && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-sm flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          Worker running
          {summary.running > 0 && ` — processing ${summary.running} job${summary.running !== 1 ? "s" : ""}`}
          {summary.pending > 0 && `, ${summary.pending} in queue`}
        </div>
      )}
      {workerOffline && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-sm flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
          Worker offline — {summary!.pending} job{summary!.pending !== 1 ? "s" : ""} waiting
        </div>
      )}

      {/* Status tabs */}
      <div className="flex items-center gap-1 mb-4 bg-[#141414] rounded-lg border border-[#1e1e1e] p-1 w-fit">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => { setStatusFilter(tab.value); setPage(1); }}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              statusFilter === tab.value
                ? "bg-[#252525] text-white"
                : "text-[#6b6b6b] hover:text-[#a0a0a0]"
            }`}
          >
            {tab.label}
            {tab.value && summary ? (
              <span className="ml-1 text-[#6b6b6b]">
                {summary[tab.value as keyof Pick<QueueSummary, "pending" | "running" | "done" | "failed">]}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-[#141414] rounded-lg border border-[#1e1e1e] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#1e1e1e]">
                <th className="text-left px-4 py-3 text-[#6b6b6b] font-medium">ID</th>
                <th className="text-left px-4 py-3 text-[#6b6b6b] font-medium">Account</th>
                <th className="text-left px-4 py-3 text-[#6b6b6b] font-medium">Platform</th>
                <th className="text-center px-4 py-3 text-[#6b6b6b] font-medium">Status</th>
                <th className="text-left px-4 py-3 text-[#6b6b6b] font-medium">Info</th>
                <th className="text-right px-4 py-3 text-[#6b6b6b] font-medium w-20">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-[#6b6b6b]">
                    Loading...
                  </td>
                </tr>
              ) : data && data.items.length > 0 ? (
                data.items.map((item) => (
                  <tr
                    key={item.id}
                    className="border-b border-[#1e1e1e] hover:bg-[#1a1a1a] transition-colors"
                  >
                    <td className="px-4 py-3 text-[#6b6b6b] tabular-nums">
                      #{item.id}
                    </td>
                    <td className="px-4 py-3 text-white font-medium">
                      @{item.username}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-medium capitalize ${
                          item.platform === "twitter"
                            ? "bg-blue-500/10 text-blue-400"
                            : "bg-pink-500/10 text-pink-400"
                        }`}
                      >
                        {item.platform}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <StatusBadge status={item.status} />
                    </td>
                    <td className="px-4 py-3">
                      <ItemInfo item={item} position={pendingPositions.get(item.id)} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {item.status === "pending" && (
                        <button
                          onClick={() => handleCancel(item.id)}
                          className="px-2 py-1 text-xs rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                          title="Cancel this job"
                        >
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-[#6b6b6b]">
                    No queue items found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data && data.total_pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-[#1e1e1e]">
            <span className="text-sm text-[#6b6b6b]">
              Page {data.page} of {data.total_pages} ({data.total} items)
            </span>
            <div className="flex gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                className="px-3 py-1.5 text-sm rounded bg-[#1e1e1e] text-[#a0a0a0] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <button
                disabled={page >= data.total_pages}
                onClick={() => setPage(page + 1)}
                className="px-3 py-1.5 text-sm rounded bg-[#1e1e1e] text-[#a0a0a0] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ItemInfo({
  item,
  position,
}: {
  item: { status: string; created_at: string; started_at?: string; finished_at?: string; videos_found: number; error?: string };
  position?: number;
}) {
  if (item.status === "pending") {
    return (
      <div className="flex items-center gap-3 text-sm">
        <span className="text-yellow-400/80">
          Queued {timeAgo(item.created_at)}
        </span>
        {position !== undefined && (
          <span className="text-[#6b6b6b]">#{position} in queue</span>
        )}
      </div>
    );
  }

  if (item.status === "running") {
    return (
      <div className="flex items-center gap-3 text-sm">
        <span className="flex items-center gap-1.5 text-blue-400">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
          Running for {item.started_at ? timeAgo(item.started_at).replace(" ago", "") : "..."}
        </span>
        {item.videos_found > 0 && (
          <span className="text-white tabular-nums">{item.videos_found} videos</span>
        )}
      </div>
    );
  }

  if (item.status === "done") {
    return (
      <div className="flex items-center gap-3 text-sm">
        <span className="text-green-400 tabular-nums">{item.videos_found} videos found</span>
        {item.finished_at && (
          <span className="text-[#6b6b6b]">{timeAgo(item.finished_at)}</span>
        )}
      </div>
    );
  }

  if (item.status === "failed") {
    return (
      <div className="text-sm">
        <span className="text-red-400 max-w-[400px] truncate block" title={item.error || ""}>
          {item.error || "Unknown error"}
        </span>
        {item.finished_at && (
          <span className="text-[#6b6b6b] text-xs">{timeAgo(item.finished_at)}</span>
        )}
      </div>
    );
  }

  return <span className="text-[#6b6b6b]">-</span>;
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: "bg-yellow-500/10 text-yellow-400",
    running: "bg-blue-500/10 text-blue-400",
    done: "bg-green-500/10 text-green-400",
    failed: "bg-red-500/10 text-red-400",
  };

  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-xs font-medium capitalize ${
        styles[status] || "bg-[#2a2a2a] text-[#a0a0a0]"
      }`}
    >
      {status}
    </span>
  );
}

export default function QueuePage() {
  return (
    <ToastProvider>
      <QueueContent />
    </ToastProvider>
  );
}
