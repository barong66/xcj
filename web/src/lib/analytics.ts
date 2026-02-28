"use client";

import type { AnalyticsEvent } from "@/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

export function sendEvent(event: AnalyticsEvent): void {
  const payload: AnalyticsEvent = {
    ...event,
    timestamp: Date.now(),
  };

  if (typeof navigator !== "undefined" && "sendBeacon" in navigator) {
    navigator.sendBeacon(
      `${API_URL}/api/v1/events`,
      JSON.stringify(payload)
    );
  } else {
    fetch(`${API_URL}/api/v1/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {
      // Silently fail analytics
    });
  }
}

export function trackView(videoId: string): void {
  sendEvent({ type: "view", video_id: videoId });
}

export function trackClick(videoId: string): void {
  sendEvent({ type: "click", video_id: videoId });
}

export function trackHover(videoId: string): void {
  sendEvent({ type: "hover", video_id: videoId });
}

export function trackImpression(videoId: string): void {
  sendEvent({ type: "impression", video_id: videoId });
}
