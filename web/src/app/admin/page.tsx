"use client";

import { useEffect, useState } from "react";
import { getAdminStats, reparseAllAccounts, recategorizeVideos } from "@/lib/admin-api";
import type { AdminStats } from "@/lib/admin-api";
import { ToastProvider, useToast } from "./Toast";

function DashboardContent() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { toast } = useToast();

  const loadStats = async () => {
    try {
      setLoading(true);
      const data = await getAdminStats();
      setStats(data);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load stats");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
  }, []);

  const handleReparseAll = async () => {
    try {
      const result = await reparseAllAccounts();
      toast(`Enqueued ${result.enqueued} accounts for reparsing`);
      loadStats();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to reparse", "error");
    }
  };

  const handleRecategorize = async () => {
    try {
      const result = await recategorizeVideos({ all: true });
      toast(`Queued ${result.updated} videos for recategorization`);
      loadStats();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to recategorize", "error");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-[#6b6b6b] text-sm">Loading stats...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-red-400 text-sm">
        {error}
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-white">Dashboard</h1>
        <button
          onClick={loadStats}
          className="text-sm text-[#a0a0a0] hover:text-white transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Total Videos"
          value={stats.active_videos.toLocaleString()}
          sub={`${stats.inactive_videos.toLocaleString()} inactive`}
          color="accent"
        />
        <StatCard
          label="Total Accounts"
          value={stats.total_accounts.toLocaleString()}
          sub={stats.accounts_by_platform
            ?.map((p) => `${p.platform}: ${p.active}`)
            .join(", ") || "no accounts"}
          color="blue"
        />
        <StatCard
          label="Parse Queue"
          value={(stats.queue_pending + stats.queue_running).toLocaleString()}
          sub={`${stats.queue_pending} pending, ${stats.queue_running} running`}
          color="yellow"
        />
        <StatCard
          label="Uncategorized"
          value={stats.uncategorized.toLocaleString()}
          sub="need AI processing"
          color="orange"
        />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Videos Today"
          value={stats.videos_today.toLocaleString()}
          color="green"
        />
        <StatCard
          label="Videos This Week"
          value={stats.videos_this_week.toLocaleString()}
          color="green"
        />
        <StatCard
          label="Queue Done"
          value={stats.queue_done.toLocaleString()}
          color="green"
        />
        <StatCard
          label="Queue Failed"
          value={stats.queue_failed.toLocaleString()}
          color="red"
        />
      </div>

      {/* Quick actions */}
      <div className="bg-[#141414] rounded-lg border border-[#1e1e1e] p-5">
        <h2 className="text-sm font-semibold text-white mb-4">Quick Actions</h2>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleReparseAll}
            className="px-4 py-2 text-sm rounded-lg bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
          >
            Reparse All Accounts
          </button>
          <button
            onClick={handleRecategorize}
            className="px-4 py-2 text-sm rounded-lg bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 transition-colors"
          >
            Run Categorizer
          </button>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  color = "accent",
}: {
  label: string;
  value: string;
  sub?: string;
  color?: "accent" | "blue" | "green" | "yellow" | "orange" | "red";
}) {
  const colorMap = {
    accent: "text-accent",
    blue: "text-blue-400",
    green: "text-green-400",
    yellow: "text-yellow-400",
    orange: "text-orange-400",
    red: "text-red-400",
  };

  return (
    <div className="bg-[#141414] rounded-lg border border-[#1e1e1e] p-4">
      <p className="text-xs text-[#6b6b6b] uppercase tracking-wide mb-1">
        {label}
      </p>
      <p className={`text-2xl font-bold ${colorMap[color]}`}>{value}</p>
      {sub && <p className="text-xs text-[#6b6b6b] mt-1">{sub}</p>}
    </div>
  );
}

export default function AdminDashboardPage() {
  return (
    <ToastProvider>
      <DashboardContent />
    </ToastProvider>
  );
}
