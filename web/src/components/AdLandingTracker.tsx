"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { trackAdLanding } from "@/lib/analytics";

const AD_PARAM_KEYS = [
  "ref_domain", "original_ref", "spot_id", "node_id",
  "auction_price", "cpv_price", "cpc", "campaign_id", "creative_id",
];

interface AdLandingTrackerProps {
  source: string;
  anchor?: string;
  clickId?: string;
}

export function AdLandingTracker({ source, anchor, clickId }: AdLandingTrackerProps) {
  const tracked = useRef(false);
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!tracked.current && source) {
      trackAdLanding(source, anchor);
      sessionStorage.setItem("ad_source", source);
      if (clickId) {
        sessionStorage.setItem("ad_click_id", clickId);
      }
      // Store ad network params from URL query.
      const adParams: Record<string, string> = {};
      for (const key of AD_PARAM_KEYS) {
        const val = searchParams.get(key);
        if (val) adParams[key] = val;
      }
      if (Object.keys(adParams).length > 0) {
        sessionStorage.setItem("ad_params", JSON.stringify(adParams));
      }
      tracked.current = true;
    }
  }, [source, anchor, clickId, searchParams]);

  return null;
}
