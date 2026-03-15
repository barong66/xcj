"use client";

import { useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import type { Account, Video } from "@/types";
import type { FeedItem } from "@/lib/feed-types";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { ProfileGrid } from "./ProfileGrid";

interface ProfileContentProps {
  account: Account;
  initialFeed: FeedItem[];
  totalPages: number;
  slug: string;
  perPage: number;
}

export function ProfileContent({
  account,
  initialFeed,
  totalPages,
  slug,
  perPage,
}: ProfileContentProps) {
  const initialVideos = initialFeed.map((item) => item.video);
  const searchParams = useSearchParams();
  const clickedVideoId = searchParams.get("v");

  // Reorder: put clicked video first
  const reorderedInitial = useMemo(() => {
    if (!clickedVideoId) return initialVideos;
    const idx = initialVideos.findIndex((v) => String(v.id) === clickedVideoId);
    if (idx <= 0) return initialVideos; // already first or not found
    const copy = [...initialVideos];
    const [clicked] = copy.splice(idx, 1);
    copy.unshift(clicked);
    return copy;
  }, [initialVideos, clickedVideoId]);

  const extractItems = useCallback(
    (data: Record<string, unknown>) => (data.videos as Video[]) || [],
    [],
  );

  const { items, sentinelRef, isLoading, hasMore } = useInfiniteScroll<Video>({
    initialItems: reorderedInitial,
    initialPage: 1,
    totalPages,
    fetchUrl: `/api/v1/accounts/slug/${encodeURIComponent(slug)}?per_page=${perPage}`,
    extractItems,
  });

  return (
    <ProfileGrid
      videos={items}
      accountId={account.id}
      sentinelRef={sentinelRef}
      isLoading={isLoading}
      hasMore={hasMore}
    />
  );
}
