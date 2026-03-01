"use client";

import { useEffect, useRef } from "react";
import { trackProfileView } from "@/lib/analytics";

interface ProfileViewTrackerProps {
  accountId: number;
}

export function ProfileViewTracker({ accountId }: ProfileViewTrackerProps) {
  const tracked = useRef(false);

  useEffect(() => {
    if (!tracked.current) {
      trackProfileView(accountId);
      tracked.current = true;
    }
  }, [accountId]);

  return null;
}
