"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { getHealthStatus } from "@/lib/admin-api";
import type {
  HealthStatus,
  ComponentStatus,
  WorkerStatusInfo,
  ServiceInfo,
} from "@/lib/admin-api";
import { ToastProvider, useToast } from "../Toast";

const REFRESH_OPTIONS = [
  { label: "Off", value: 0 },
  { label: "10s", value: 10_000 },
  { label: "30s", value: 30_000 },
  { label: "60s", value: 60_000 },
];

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ${min % 60}m ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

// ─── Status Colors ──────────────────────────────────────────────────────────

const infraColors: Record<string, string> = {
  healthy: "text-green-400",
  unhealthy: "text-red-400",
  degraded: "text-yellow-400",
  unknown: "text-[#6b6b6b]",
};

const infraDotColors: Record<string, string> = {
  healthy: "bg-green-400",
  unhealthy: "bg-red-400 animate-pulse",
  degraded: "bg-yellow-400",
  unknown: "bg-[#6b6b6b]",
};

const workerColors: Record<string, string> = {
  active: "text-green-400",
  idle: "text-blue-400",
  offline: "text-red-400",
  unknown: "text-[#6b6b6b]",
};

const workerDotColors: Record<string, string> = {
  active: "bg-green-400",
  idle: "bg-blue-400",
  offline: "bg-red-400 animate-pulse",
  unknown: "bg-[#6b6b6b]",
};

const overallColors: Record<string, { bg: string; text: string; border: string }> = {
  healthy: {
    bg: "bg-green-500/10",
    text: "text-green-400",
    border: "border-green-500/20",
  },
  degraded: {
    bg: "bg-yellow-500/10",
    text: "text-yellow-400",
    border: "border-yellow-500/20",
  },
  unhealthy: {
    bg: "bg-red-500/10",
    text: "text-red-400",
    border: "border-red-500/20",
  },
};

const infraLabels: Record<string, string> = {
  postgresql: "PostgreSQL",
  redis: "Redis",
  clickhouse: "ClickHouse",
};

const workerLabels: Record<string, string> = {
  parser: "Parser Worker",
  categorizer: "AI Categorizer",
};

const serviceLabels: Record<string, string> = {
  go_api: "Go API",
  event_buffer: "Event Buffer",
};

// ─── Components ─────────────────────────────────────────────────────────────

function InfraCard({ component }: { component: ComponentStatus }) {
  const isHealthy = component.status === "healthy";
  return (
    <div className="bg-[#141414] rounded-lg border border-[#1e1e1e] p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-[#6b6b6b] uppercase tracking-wide">
          {infraLabels[component.name] || component.name}
        </p>
        <span
          className={`inline-block w-2 h-2 rounded-full ${infraDotColors[component.status] || infraDotColors.unknown}`}
        />
      </div>
      <p className={`text-lg font-bold capitalize ${infraColors[component.status] || infraColors.unknown}`}>
        {component.status}
      </p>
      {component.latency_ms !== undefined && (
        <p className="text-xs text-[#6b6b6b] mt-1">
          {component.latency_ms.toFixed(2)} ms
        </p>
      )}
      {component.message && (
        <p
          className="text-xs text-red-400 mt-1 truncate"
          title={component.message}
        >
          {component.message}
        </p>
      )}
    </div>
  );
}

function WorkerCard({ worker }: { worker: WorkerStatusInfo }) {
  return (
    <div className="bg-[#141414] rounded-lg border border-[#1e1e1e] p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-[#6b6b6b] uppercase tracking-wide">
          {workerLabels[worker.name] || worker.name}
        </p>
        <span
          className={`inline-block w-2 h-2 rounded-full ${workerDotColors[worker.status] || workerDotColors.unknown}`}
        />
      </div>
      <p className={`text-lg font-bold capitalize ${workerColors[worker.status] || workerColors.unknown}`}>
        {worker.status}
      </p>
      {worker.details && (
        <p className="text-xs text-[#6b6b6b] mt-1">{worker.details}</p>
      )}
      {worker.last_activity && (
        <p className="text-xs text-[#6b6b6b] mt-0.5">
          {timeAgo(worker.last_activity)}
        </p>
      )}
    </div>
  );
}

function ServiceCard({ service }: { service: ServiceInfo }) {
  return (
    <div className="bg-[#141414] rounded-lg border border-[#1e1e1e] p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-[#6b6b6b] uppercase tracking-wide">
          {serviceLabels[service.name] || service.name}
        </p>
        <span
          className={`inline-block w-2 h-2 rounded-full ${
            service.status === "healthy" ? "bg-green-400" : "bg-red-400"
          }`}
        />
      </div>
      <p
        className={`text-lg font-bold capitalize ${
          service.status === "healthy" ? "text-green-400" : "text-red-400"
        }`}
      >
        {service.status}
      </p>
      {service.details && (
        <p className="text-xs text-[#6b6b6b] mt-1">{service.details}</p>
      )}
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

function HealthContent() {
  const [data, setData] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshInterval, setRefreshInterval] = useState(30_000);
  const { toast } = useToast();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadHealth = useCallback(async () => {
    try {
      setLoading(true);
      const result = await getHealthStatus();
      setData(result);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load health");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHealth();
  }, [loadHealth]);

  // Auto-refresh.
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (refreshInterval > 0) {
      intervalRef.current = setInterval(loadHealth, refreshInterval);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [refreshInterval, loadHealth]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-[#6b6b6b] text-sm">Loading health status...</div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-red-400 text-sm">
        {error}
      </div>
    );
  }

  if (!data) return null;

  const overall = overallColors[data.status] || overallColors.unhealthy;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-white">System Health</h1>
        <div className="flex items-center gap-3">
          {/* Auto-refresh toggle */}
          <div className="flex items-center gap-1 bg-[#141414] rounded-lg border border-[#1e1e1e] p-0.5">
            {REFRESH_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setRefreshInterval(opt.value)}
                className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                  refreshInterval === opt.value
                    ? "bg-accent/20 text-accent"
                    : "text-[#6b6b6b] hover:text-white"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button
            onClick={loadHealth}
            className="text-sm text-[#a0a0a0] hover:text-white transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Overall status banner */}
      <div
        className={`rounded-lg border p-4 mb-6 flex items-center justify-between ${overall.bg} ${overall.border}`}
      >
        <div className="flex items-center gap-3">
          <span
            className={`inline-block w-3 h-3 rounded-full ${
              data.status === "healthy"
                ? "bg-green-400"
                : data.status === "degraded"
                ? "bg-yellow-400 animate-pulse"
                : "bg-red-400 animate-pulse"
            }`}
          />
          <span className={`text-lg font-bold capitalize ${overall.text}`}>
            {data.status}
          </span>
        </div>
        <div className="text-xs text-[#6b6b6b]">
          Uptime: {formatUptime(data.uptime_seconds)}
          {loading && (
            <span className="ml-2 text-accent">updating...</span>
          )}
        </div>
      </div>

      {/* Infrastructure */}
      <h2 className="text-sm font-semibold text-white mb-3">Infrastructure</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        {data.infrastructure.map((c) => (
          <InfraCard key={c.name} component={c} />
        ))}
      </div>

      {/* Workers */}
      <h2 className="text-sm font-semibold text-white mb-3">Workers</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        {data.workers.map((w) => (
          <WorkerCard key={w.name} worker={w} />
        ))}
      </div>

      {/* Services */}
      <h2 className="text-sm font-semibold text-white mb-3">Services</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {data.services.map((s) => (
          <ServiceCard key={s.name} service={s} />
        ))}
      </div>
    </div>
  );
}

export default function HealthPage() {
  return (
    <ToastProvider>
      <HealthContent />
    </ToastProvider>
  );
}
