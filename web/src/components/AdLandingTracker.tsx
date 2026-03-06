"use client";

import { useEffect, useRef } from "react";
import { trackAdLanding } from "@/lib/analytics";

interface AdLandingTrackerProps {
  source: string;
  anchor?: string;
  clickId?: string;
}

export function AdLandingTracker({ source, anchor, clickId }: AdLandingTrackerProps) {
  const tracked = useRef(false);

  useEffect(() => {
    if (!tracked.current && source) {
      trackAdLanding(source, anchor);
      sessionStorage.setItem("ad_source", source);
      if (clickId) {
        sessionStorage.setItem("ad_click_id", clickId);
      }
      tracked.current = true;
    }
  }, [source, anchor, clickId]);

  return null;
}
