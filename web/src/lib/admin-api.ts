function getApiUrl(): string {
  if (typeof window !== "undefined") {
    // Browser: relative URL → hits Next.js proxy routes on same origin.
    return "";
  }
  // Server-side (SSR / API routes): call Go API directly.
  return process.env.API_URL || "http://localhost:8080";
}

function getAdminBearer(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie.match(/(?:^|;\s*)admin_bearer=([^;]*)/);
  return match?.[1] || undefined;
}

async function adminFetch<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const url = `${getApiUrl()}/api/v1/admin${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options?.headers as Record<string, string>) || {}),
  };
  // Send Bearer token directly so requests work even when nginx
  // routes /api/v1/admin/* to Go API (bypassing Next.js proxy).
  const bearer = getAdminBearer();
  if (bearer) {
    headers["Authorization"] = `Bearer ${bearer}`;
  }
  const res = await fetch(url, {
    ...options,
    credentials: "same-origin",
    headers,
  });

  if (res.status === 401) {
    if (typeof window !== "undefined") {
      window.location.href = "/admin/login";
    }
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `API error: ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PlatformAccountCount {
  platform: string;
  total: number;
  active: number;
}

export interface AdminStats {
  total_videos: number;
  active_videos: number;
  inactive_videos: number;
  total_accounts: number;
  accounts_by_platform: PlatformAccountCount[];
  queue_pending: number;
  queue_running: number;
  queue_done: number;
  queue_failed: number;
  uncategorized: number;
  videos_today: number;
  videos_this_week: number;
}

export interface AdminAccount {
  id: number;
  platform: string;
  username: string;
  slug: string;
  display_name: string;
  avatar_url: string;
  bio: string;
  social_links: Record<string, string>;
  is_active: boolean;
  is_paid: boolean;
  paid_until?: string;
  follower_count: number;
  last_parsed_at?: string;
  parse_errors: number;
  video_count: number;
  created_at: string;
}

export interface AdminAccountList {
  accounts: AdminAccount[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

export interface AdminQueueItem {
  id: number;
  account_id: number;
  username: string;
  platform: string;
  status: string;
  videos_found: number;
  error?: string;
  created_at: string;
  started_at?: string;
  finished_at?: string;
}

export interface AdminQueueList {
  items: AdminQueueItem[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

export interface AdminVideoCategory {
  id: number;
  slug: string;
  name: string;
  confidence: number;
}

export interface AdminVideo {
  id: number;
  account_id: number;
  platform: string;
  platform_id: string;
  original_url: string;
  title: string;
  description: string;
  duration_sec: number;
  thumbnail_url: string;
  preview_url: string;
  width: number;
  height: number;
  view_count: number;
  click_count: number;
  is_active: boolean;
  published_at?: string;
  created_at: string;
  username: string;
  categories: AdminVideoCategory[];
}

export interface AdminVideoList {
  videos: AdminVideo[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

export interface AdminCategory {
  id: number;
  slug: string;
  name: string;
  parent_id?: number;
  is_active: boolean;
  sort_order: number;
  video_count: number;
}

export interface SiteConfig {
  show_social_buttons?: boolean;
}

export interface AdminSite {
  id: number;
  slug: string;
  domain: string;
  name: string;
  config: SiteConfig;
  is_active: boolean;
  created_at: string;
  category_count: number;
  video_count: number;
}

// ─── API Calls ───────────────────────────────────────────────────────────────

export async function getAdminStats(): Promise<AdminStats> {
  return adminFetch<AdminStats>("/stats");
}

export async function getAdminAccount(id: number): Promise<AdminAccount> {
  return adminFetch<AdminAccount>(`/accounts/${id}`);
}

export async function getAdminAccounts(params?: {
  platform?: string;
  status?: string;
  paid?: string;
  page?: number;
  per_page?: number;
}): Promise<AdminAccountList> {
  const sp = new URLSearchParams();
  if (params?.platform) sp.set("platform", params.platform);
  if (params?.status) sp.set("status", params.status);
  if (params?.paid) sp.set("paid", params.paid);
  if (params?.page) sp.set("page", String(params.page));
  if (params?.per_page) sp.set("per_page", String(params.per_page));
  const qs = sp.toString();
  return adminFetch<AdminAccountList>(`/accounts${qs ? `?${qs}` : ""}`);
}

export async function createAdminAccount(data: {
  platform: string;
  username: string;
  max_videos?: number;
}): Promise<AdminAccount> {
  return adminFetch<AdminAccount>("/accounts", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateAdminAccount(
  id: number,
  data: { is_active?: boolean; is_paid?: boolean; social_links?: Record<string, string> }
): Promise<AdminAccount> {
  return adminFetch<AdminAccount>(`/accounts/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteAdminAccount(id: number): Promise<void> {
  await adminFetch(`/accounts/${id}`, { method: "DELETE" });
}

export async function reparseAccount(id: number): Promise<void> {
  await adminFetch(`/accounts/${id}/reparse`, { method: "POST" });
}

export async function reparseAllAccounts(): Promise<{ enqueued: number }> {
  return adminFetch<{ enqueued: number }>("/accounts/reparse-all", {
    method: "POST",
  });
}

export async function getAdminQueue(params?: {
  status?: string;
  page?: number;
  per_page?: number;
}): Promise<AdminQueueList> {
  const sp = new URLSearchParams();
  if (params?.status) sp.set("status", params.status);
  if (params?.page) sp.set("page", String(params.page));
  if (params?.per_page) sp.set("per_page", String(params.per_page));
  const qs = sp.toString();
  return adminFetch<AdminQueueList>(`/queue${qs ? `?${qs}` : ""}`);
}

export async function retryFailedJobs(): Promise<{ retried: number }> {
  return adminFetch<{ retried: number }>("/queue/retry-failed", {
    method: "POST",
  });
}

export async function clearFailedJobs(): Promise<{ cleared: number }> {
  return adminFetch<{ cleared: number }>("/queue/failed", {
    method: "DELETE",
  });
}

export interface QueueSummary {
  pending: number;
  running: number;
  done: number;
  failed: number;
  last_finished_at: string | null;
  worker_running: boolean;
}

export async function getQueueSummary(): Promise<QueueSummary> {
  return adminFetch<QueueSummary>("/queue/summary");
}

export async function cancelQueueItem(id: number): Promise<void> {
  await adminFetch(`/queue/${id}`, { method: "DELETE" });
}

export async function getAdminVideos(params?: {
  category?: string;
  uncategorized?: boolean;
  page?: number;
  per_page?: number;
}): Promise<AdminVideoList> {
  const sp = new URLSearchParams();
  if (params?.category) sp.set("category", params.category);
  if (params?.uncategorized) sp.set("uncategorized", "true");
  if (params?.page) sp.set("page", String(params.page));
  if (params?.per_page) sp.set("per_page", String(params.per_page));
  const qs = sp.toString();
  return adminFetch<AdminVideoList>(`/videos${qs ? `?${qs}` : ""}`);
}

export async function deleteAdminVideo(id: number): Promise<void> {
  await adminFetch(`/videos/${id}`, { method: "DELETE" });
}

export async function recategorizeVideos(data: {
  video_ids?: number[];
  all?: boolean;
}): Promise<{ updated: number }> {
  return adminFetch<{ updated: number }>("/videos/recategorize", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function getAdminCategories(): Promise<AdminCategory[]> {
  const res = await adminFetch<{ categories: AdminCategory[] }>("/categories");
  return res.categories;
}

export async function getAdminSites(): Promise<AdminSite[]> {
  const res = await adminFetch<{ sites: AdminSite[] }>("/sites");
  return res.sites;
}

export async function getAdminSite(id: number): Promise<AdminSite> {
  return adminFetch<AdminSite>(`/sites/${id}`);
}

export async function updateAdminSite(
  id: number,
  data: { config: SiteConfig },
): Promise<AdminSite> {
  return adminFetch<AdminSite>(`/sites/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function refreshSiteContent(
  id: number,
): Promise<{ status: string; enqueued: number }> {
  return adminFetch<{ status: string; enqueued: number }>(
    `/sites/${id}/refresh`,
    { method: "POST" },
  );
}

// ─── Bulk Import ─────────────────────────────────────────────────────────────

export interface BulkCreateAccountResult {
  username: string;
  status: "created" | "existing" | "error";
  error?: string;
}

export interface BulkCreateResult {
  total: number;
  created: number;
  existing: number;
  errors: number;
  accounts: BulkCreateAccountResult[];
}

export async function bulkCreateAccounts(data: {
  platform: string;
  usernames: string[];
}): Promise<BulkCreateResult> {
  const results: BulkCreateAccountResult[] = [];

  for (const username of data.usernames) {
    try {
      await createAdminAccount({ platform: data.platform, username });
      results.push({ username, status: "created" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      if (msg.includes("already exists") || msg.includes("409")) {
        results.push({ username, status: "existing" });
      } else {
        results.push({ username, status: "error", error: msg });
      }
    }
  }

  return {
    total: results.length,
    created: results.filter((r) => r.status === "created").length,
    existing: results.filter((r) => r.status === "existing").length,
    errors: results.filter((r) => r.status === "error").length,
    accounts: results,
  };
}

// ─── Finder ──────────────────────────────────────────────────────────────────

export interface FinderAccount {
  username: string;
  display_name: string;
  follower_count: number;
  video_tweet_count: number;
  total_engagement: number;
  profile_image_url: string | null;
  account_id: number | null;
  job_id: number | null;
  status: "created" | "existing" | "error";
  error: string | null;
}

export interface FinderResult {
  keyword: string;
  platform: string;
  accounts_found: number;
  accounts: FinderAccount[];
}

export async function runFinder(data: {
  keyword: string;
  count: number;
  platform: string;
}): Promise<FinderResult> {
  // Finder route lives in Next.js (not Go API), so use relative URL.
  const res = await fetch("/api/v1/admin/finder", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Finder error: ${res.status}`);
  }
  return res.json();
}

// ─── Health Check ─────────────────────────────────────────────────────────────

export interface ComponentStatus {
  name: string;
  status: "healthy" | "unhealthy" | "degraded" | "unknown";
  latency_ms?: number;
  message?: string;
}

export interface WorkerStatusInfo {
  name: string;
  status: "active" | "idle" | "offline" | "unknown";
  last_activity?: string;
  details?: string;
}

export interface ServiceInfo {
  name: string;
  status: string;
  details?: string;
}

export interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  uptime_seconds: number;
  infrastructure: ComponentStatus[];
  workers: WorkerStatusInfo[];
  services: ServiceInfo[];
}

export async function getHealthStatus(): Promise<HealthStatus> {
  return adminFetch<HealthStatus>("/health");
}

// ─── Video Stats (from ClickHouse site analytics) ────────────────────────────

export interface VideoStatItem {
  id: number;
  platform: string;
  platform_id: string;
  title: string;
  thumbnail_url: string;
  duration_sec: number;
  username: string;
  impressions: number;
  clicks: number;
  ctr: number;
  created_at: string;
}

export interface VideoStatsList {
  videos: VideoStatItem[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
  total_impressions: number;
  total_clicks: number;
  total_ctr: number;
}

export async function getVideoStats(params?: {
  sort?: string;
  dir?: string;
  page?: number;
  per_page?: number;
}): Promise<VideoStatsList> {
  const sp = new URLSearchParams();
  if (params?.sort) sp.set("sort", params.sort);
  if (params?.dir) sp.set("dir", params.dir);
  if (params?.page) sp.set("page", String(params.page));
  if (params?.per_page) sp.set("per_page", String(params.per_page));
  const qs = sp.toString();
  return adminFetch<VideoStatsList>(`/videos/stats${qs ? `?${qs}` : ""}`);
}

// ─── Banners ──────────────────────────────────────────────────────────────────

export interface BannerSize {
  id: number;
  width: number;
  height: number;
  label: string;
  type: string;
  is_active: boolean;
  created_at: string;
}

export interface BannerSizeSummary {
  banner_size_id: number;
  width: number;
  height: number;
  label: string;
  count: number;
}

export interface AdminBanner {
  id: number;
  account_id: number;
  video_id: number;
  banner_size_id: number;
  video_frame_id: number | null;
  image_url: string;
  source_image_url: string;
  width: number;
  height: number;
  is_active: boolean;
  created_at: string;
  video_title: string;
  username: string;
  impressions: number;
  hovers: number;
  clicks: number;
  ctr: number;
}

export interface AdminBannerList {
  banners: AdminBanner[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

export async function getBannerSizes(): Promise<BannerSize[]> {
  const res = await adminFetch<{ sizes: BannerSize[] }>("/banner-sizes");
  return res.sizes;
}

export async function createBannerSize(data: {
  width: number;
  height: number;
  label: string;
  type?: string;
}): Promise<BannerSize> {
  return adminFetch<BannerSize>("/banner-sizes", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function getAccountBannerSummary(
  accountId: number,
): Promise<BannerSizeSummary[]> {
  const res = await adminFetch<{ sizes: BannerSizeSummary[] }>(
    `/accounts/${accountId}/banners/summary`,
  );
  return res.sizes;
}

export async function getAccountBanners(
  accountId: number,
  params?: { size_id?: number; page?: number; per_page?: number },
): Promise<AdminBannerList> {
  const sp = new URLSearchParams();
  if (params?.size_id) sp.set("size_id", String(params.size_id));
  if (params?.page) sp.set("page", String(params.page));
  if (params?.per_page) sp.set("per_page", String(params.per_page));
  const qs = sp.toString();
  return adminFetch<AdminBannerList>(
    `/accounts/${accountId}/banners${qs ? `?${qs}` : ""}`,
  );
}

// ─── Account Stats ───────────────────────────────────────────────────────────

export interface AccountDayStat {
  date: string;
  profile_views: number;
  instagram_clicks: number;
  paid_site_clicks: number;
  video_clicks: number;
  thumb_impressions: number;
  unique_sessions: number;
  avg_session_sec: number;
}

export interface AccountStatsResponse {
  stats: AccountDayStat[];
  summary: AccountDayStat;
  days: number;
}

export async function getAccountStats(
  accountId: number,
  days?: number,
): Promise<AccountStatsResponse> {
  const sp = new URLSearchParams();
  if (days) sp.set("days", String(days));
  const qs = sp.toString();
  return adminFetch<AccountStatsResponse>(
    `/accounts/${accountId}/stats${qs ? `?${qs}` : ""}`,
  );
}

export async function generateAccountBanners(
  accountId: number,
): Promise<{ status: string }> {
  return adminFetch<{ status: string }>(
    `/accounts/${accountId}/banners/generate`,
    { method: "POST" },
  );
}

export async function getAllBanners(params?: {
  page?: number;
  per_page?: number;
}): Promise<AdminBannerList> {
  const sp = new URLSearchParams();
  if (params?.page) sp.set("page", String(params.page));
  if (params?.per_page) sp.set("per_page", String(params.per_page));
  const qs = sp.toString();
  return adminFetch<AdminBannerList>(`/banners${qs ? `?${qs}` : ""}`);
}

export async function deactivateBanner(id: number): Promise<void> {
  await adminFetch(`/banners/${id}`, { method: "DELETE" });
}

export async function batchDeactivateBanners(
  ids: number[],
): Promise<{ deactivated: number }> {
  return adminFetch<{ deactivated: number }>("/banners/batch-deactivate", {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
}

export async function batchRegenerateBanners(
  ids: number[],
): Promise<{ enqueued: number }> {
  return adminFetch<{ enqueued: number }>("/banners/batch-regenerate", {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
}

export async function recropBanner(
  bannerId: number,
  crop: { x: number; y: number; width: number; height: number },
): Promise<{ image_url: string }> {
  return adminFetch<{ image_url: string }>(`/banners/${bannerId}/recrop`, {
    method: "POST",
    body: JSON.stringify(crop),
  });
}

// ─── Ad Sources ──────────────────────────────────────────────────────────────

export interface AdSource {
  id: number;
  name: string;
  postback_url: string;
  is_active: boolean;
  created_at: string;
}

export async function getAdSources(): Promise<AdSource[]> {
  const res = await adminFetch<{ ad_sources: AdSource[] }>("/ad-sources");
  return res.ad_sources;
}

export async function createAdSource(data: {
  name: string;
  postback_url: string;
}): Promise<AdSource> {
  return adminFetch<AdSource>("/ad-sources", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateAdSource(
  id: number,
  data: { name?: string; postback_url?: string; is_active?: boolean },
): Promise<AdSource> {
  return adminFetch<AdSource>(`/ad-sources/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

// ─── Banner Funnel Analytics ─────────────────────────────────────────────────

export interface BannerFunnelStat {
  source: string;
  impressions: number;
  hovers: number;
  clicks: number;
  landings: number;
  conversions: number;
  ctr: number;
  conv_rate: number;
}

export async function getBannerFunnel(
  days?: number,
): Promise<{ funnel: BannerFunnelStat[]; days: number }> {
  const sp = new URLSearchParams();
  if (days) sp.set("days", String(days));
  const qs = sp.toString();
  return adminFetch<{ funnel: BannerFunnelStat[]; days: number }>(
    `/banner-funnel${qs ? `?${qs}` : ""}`,
  );
}

// ─── Conversion Postbacks ────────────────────────────────────────────────────

export interface ConversionPostback {
  id: number;
  ad_source_id: number;
  ad_source_name: string;
  click_id: string;
  event_type: string;
  account_id: number;
  video_id: number;
  status: string;
  response_code: number;
  response_body?: string;
  created_at: string;
  sent_at?: string;
}

export async function getPostbacks(
  limit?: number,
): Promise<ConversionPostback[]> {
  const sp = new URLSearchParams();
  if (limit) sp.set("limit", String(limit));
  const qs = sp.toString();
  const res = await adminFetch<{ postbacks: ConversionPostback[] }>(
    `/postbacks${qs ? `?${qs}` : ""}`,
  );
  return res.postbacks;
}

// ─── Banner Performance Analytics ─────────────────────────────────────────────

export interface PerfSummary {
  device_type: string;
  browser: string;
  total_events: number;
  avg_image_load_ms: number;
  avg_render_ms: number;
  avg_dwell_time_ms: number;
  p95_image_load_ms: number;
  p95_render_ms: number;
  viewability_rate: number;
}

export interface DeviceBreakdown {
  device_type: string;
  os: string;
  browser: string;
  events: number;
  clicks: number;
  ctr: number;
}

export interface ReferrerStat {
  referrer_domain: string;
  category: string;
  impressions: number;
  clicks: number;
  ctr: number;
}

export async function getPerfSummary(days: number = 7): Promise<PerfSummary[]> {
  return adminFetch<PerfSummary[]>(`/perf-summary?days=${days}`);
}

export async function getDeviceBreakdown(days: number = 7): Promise<DeviceBreakdown[]> {
  return adminFetch<DeviceBreakdown[]>(`/device-breakdown?days=${days}`);
}

export async function getReferrerStats(days: number = 7): Promise<ReferrerStat[]> {
  return adminFetch<ReferrerStat[]>(`/referrer-stats?days=${days}`);
}

// ─── Traffic Explorer ─────────────────────────────────────────────────────────

export interface TrafficStatsRow {
  dimension1: string;
  dimension2?: string;
  total_events: number;
  impressions: number;
  clicks: number;
  profile_views: number;
  conversions: number;
  unique_sessions: number;
  ctr: number;
  conversion_rate: number;
}

export interface TrafficStatsResult {
  rows: TrafficStatsRow[];
  summary: TrafficStatsRow;
  group_by: string;
  group_by2?: string;
  days: number;
}

export interface TrafficDimensionValues {
  dimension: string;
  values: string[];
}

export async function getTrafficStats(params: {
  group_by?: string;
  group_by2?: string;
  days?: number;
  sort?: string;
  dir?: string;
  [key: string]: string | number | undefined;
}): Promise<TrafficStatsResult> {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([key, val]) => {
    if (val !== undefined && val !== "") sp.set(key, String(val));
  });
  const qs = sp.toString();
  return adminFetch<TrafficStatsResult>(`/traffic-stats${qs ? `?${qs}` : ""}`);
}

export async function getTrafficDimensions(
  days?: number,
): Promise<TrafficDimensionValues[]> {
  const sp = new URLSearchParams();
  if (days) sp.set("days", String(days));
  const qs = sp.toString();
  const res = await adminFetch<{ dimensions: TrafficDimensionValues[] }>(
    `/traffic-stats/dimensions${qs ? `?${qs}` : ""}`,
  );
  return res.dimensions;
}
