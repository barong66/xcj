"use client";

import { useEffect, useRef } from "react";
import { trackAdLanding } from "@/lib/analytics";

interface AdLandingTrackerProps {
  source: string;
  anchor?: string;
}

export function AdLandingTracker({ source, anchor }: AdLandingTrackerProps) {
  const tracked = useRef(false);

  useEffect(() => {
    if (!tracked.current && source) {
      trackAdLanding(source, anchor);
      sessionStorage.setItem("ad_source", source);
      tracked.current = true;
    }
  }, [source, anchor]);

  return null;
}
