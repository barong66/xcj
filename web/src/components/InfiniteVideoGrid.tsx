"use client";

import { useCallback } from "react";
import type { Video, SortOption } from "@/types";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { VideoCard } from "./VideoCard";

interface InfiniteVideoGridProps {
  initialVideos: Video[];
  initialPage: number;
  totalPages: number;
  sort?: SortOption;
  category?: string;
  country?: string;
  anchor?: string;
  src?: string;
  searchQuery?: string;
  fetchUrlOverride?: string;
}

export function InfiniteVideoGrid({
  initialVideos,
  initialPage,
  totalPages,
  sort,
  category,
  country,
  anchor,
  src,
  searchQuery,
  fetchUrlOverride,
}: InfiniteVideoGridProps) {
  let fetchUrl: string;
  if (fetchUrlOverride) {
    fetchUrl = fetchUrlOverride;
  } else if (searchQuery) {
    fetchUrl = `/api/v1/search?q=${encodeURIComponent(searchQuery)}&per_page=12`;
  } else {
    const params = new URLSearchParams();
    if (sort) params.set("sort", sort);
    if (category) params.set("category", category);
    if (country) params.set("country", country);
    if (anchor) params.set("anchor", anchor);
    if (src) params.set("src", src);
    params.set("per_page", "12");
    fetchUrl = `/api/v1/videos?${params.toString()}`;
  }

  const extractItems = useCallback(
    (data: Record<string, unknown>) => (data.videos as Video[]) || [],
    [],
  );

  const { items, sentinelRef, isLoading, hasMore } = useInfiniteScroll<Video>({
    initialItems: initialVideos,
    initialPage,
    totalPages,
    fetchUrl,
    extractItems,
  });

  if (!items || items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center px-4">
        <svg
          className="w-16 h-16 text-txt-muted mb-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z"
          />
        </svg>
        <p className="text-txt-secondary text-lg font-medium">
          No videos found
        </p>
        <p className="text-txt-muted text-sm mt-1">
          Try a different search or browse categories
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {items.map((video) => (
        <VideoCard key={video.id} video={video} />
      ))}

      {hasMore && (
        <div ref={sentinelRef} className="flex justify-center py-6">
          {isLoading && (
            <svg
              className="animate-spin w-6 h-6 text-txt-muted"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
          )}
        </div>
      )}
    </div>
  );
}
