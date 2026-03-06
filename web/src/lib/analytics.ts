"use client";

import type { AnalyticsEvent } from "@/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
const FLUSH_INTERVAL_MS = 3000;

let buffer: AnalyticsEvent[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;

function flush(): void {
  if (buffer.length === 0) return;

  const events = buffer;
  buffer = [];

  const payload = JSON.stringify(events);

  if (typeof navigator !== "undefined" && "sendBeacon" in navigator) {
    navigator.sendBeacon(`${API_URL}/api/v1/events/batch`, payload);
  } else {
    fetch(`${API_URL}/api/v1/events/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  }
}

function ensureFlushLoop(): void {
  if (flushTimer !== null) return;
  flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
    window.addEventListener("pagehide", flush);
  }
}

function pushEvent(event: AnalyticsEvent): void {
  ensureFlushLoop();

  // Enrich with ad source and click_id from sessionStorage if available.
  const enriched = { ...event, timestamp: Date.now() };
  if (typeof sessionStorage !== "undefined") {
    const adSource = sessionStorage.getItem("ad_source");
    if (adSource && !enriched.source) {
      enriched.source = adSource;
    }
    const clickId = sessionStorage.getItem("ad_click_id");
    if (clickId && !enriched.extra) {
      enriched.extra = JSON.stringify({ click_id: clickId });
    }
  }

  buffer.push(enriched);
}

// ── Legacy aliases (backward-compat) ────────────────────────────

export function sendEvent(event: AnalyticsEvent): void {
  pushEvent(event);
}

export function trackView(videoId: string): void {
  pushEvent({ type: "view", video_id: videoId });
}

export function trackClick(videoId: string): void {
  pushEvent({ type: "click", video_id: videoId });
}

export function trackHover(videoId: string): void {
  pushEvent({ type: "hover", video_id: videoId });
}

export function trackImpression(videoId: string): void {
  pushEvent({ type: "feed_impression", video_id: videoId });
}

// ── New event helpers ───────────────────────────────────────────

export function trackFeedImpression(videoId: string): void {
  pushEvent({ type: "feed_impression", video_id: videoId });
}

export function trackFeedClick(videoId: string, accountId?: number): void {
  pushEvent({
    type: "feed_click",
    video_id: videoId,
    account_id: accountId,
    source_page: "feed",
  });
}

export function trackProfileView(accountId: number): void {
  pushEvent({ type: "profile_view", account_id: accountId });
}

export function trackProfileThumbImpression(
  videoId: string,
  accountId: number,
): void {
  pushEvent({
    type: "profile_thumb_impression",
    video_id: videoId,
    account_id: accountId,
    source_page: "profile",
  });
}

export function trackProfileThumbClick(
  videoId: string,
  accountId: number,
  targetUrl: string,
): void {
  pushEvent({
    type: "profile_thumb_click",
    video_id: videoId,
    account_id: accountId,
    target_url: targetUrl,
    source_page: "profile",
  });
}

export function trackSocialClick(
  accountId: number,
  targetUrl: string,
  platform: string,
): void {
  pushEvent({
    type: "social_click",
    account_id: accountId,
    target_url: targetUrl,
    source_page: `social:${platform}`,
  });
}

export function trackShareClick(
  videoId?: string,
  accountId?: number,
): void {
  pushEvent({
    type: "share_click",
    video_id: videoId,
    account_id: accountId,
  });
}

export function trackAdLanding(source: string, anchor?: string): void {
  pushEvent({
    type: "ad_landing",
    source,
    source_page: anchor ? `anchor:${anchor}` : "feed",
  });
}

// Track the first content click per session (e.g., Instagram link on model page).
export function trackContentClick(
  accountId: number,
  targetUrl: string,
): void {
  if (typeof sessionStorage === "undefined") return;
  if (sessionStorage.getItem("content_click_sent")) return;
  sessionStorage.setItem("content_click_sent", "1");
  pushEvent({
    type: "content_click",
    account_id: accountId,
    target_url: targetUrl,
    source_page: "profile",
  });
}
