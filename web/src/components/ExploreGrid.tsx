"use client";

import { useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import type { Video } from "@/types";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { formatDuration } from "@/lib/utils";

interface ExploreGridProps {
  initialVideos: Video[];
  initialPage: number;
  totalPages: number;
}

export function ExploreGrid({
  initialVideos,
  initialPage,
  totalPages,
}: ExploreGridProps) {
  const extractItems = useCallback(
    (data: Record<string, unknown>) => (data.videos as Video[]) || [],
    [],
  );

  const { items, sentinelRef, isLoading, hasMore } = useInfiniteScroll<Video>({
    initialItems: initialVideos,
    initialPage,
    totalPages,
    fetchUrl: "/api/v1/videos?sort=random&per_page=12",
    extractItems,
  });

  if (!items || items.length === 0) return null;

  return (
    <div>
      <div className="grid grid-cols-3 gap-px bg-border">
        {items.map((video) => {
          const slug = video.account?.slug || video.account?.username || "";
          const href = `/model/${slug}?v=${video.id}`;

          return (
            <Link
              key={video.id}
              href={href}
              className="relative block aspect-[4/5] bg-bg-card"
            >
              <Image
                src={video.thumbnail_url}
                alt={video.title || ""}
                fill
                sizes="143px"
                className="object-cover"
                loading="lazy"
              />
              <span className="absolute bottom-1 right-1 px-1 py-0.5 text-[10px] font-medium bg-black/70 text-white rounded">
                {formatDuration(video.duration_sec)}
              </span>
            </Link>
          );
        })}
      </div>

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
