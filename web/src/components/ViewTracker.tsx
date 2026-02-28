"use client";

import { useEffect, useRef } from "react";
import { trackView } from "@/lib/analytics";

interface ViewTrackerProps {
  videoId: string;
}

export function ViewTracker({ videoId }: ViewTrackerProps) {
  const tracked = useRef(false);

  useEffect(() => {
    if (!tracked.current) {
      trackView(videoId);
      tracked.current = true;
    }
  }, [videoId]);

  return null;
}
