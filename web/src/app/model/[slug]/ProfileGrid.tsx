"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import type { Video } from "@/types";
import { formatDuration } from "@/lib/utils";
import { trackProfileThumbImpression } from "@/lib/analytics";

interface ProfileGridProps {
  videos: Video[];
  accountId: number;
  sentinelRef?: (node: HTMLDivElement | null) => void;
  isLoading?: boolean;
  hasMore?: boolean;
}

export function ProfileGrid({
  videos,
  accountId,
  sentinelRef,
  isLoading,
  hasMore,
}: ProfileGridProps) {
  if (!videos || videos.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-txt-muted text-sm">
        No videos yet
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {videos.map((video) => (
        <GridItem key={video.id} video={video} accountId={accountId} />
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

function GridItem({
  video,
  accountId,
}: {
  video: Video;
  accountId: number;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  const tracked = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !tracked.current) {
            trackProfileThumbImpression(video.id, accountId);
            tracked.current = true;
            observer.disconnect();
          }
        }
      },
      { threshold: 0.5 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [video.id, accountId]);

  return (
    <Link
      ref={ref}
      href={`/video/${video.id}`}
      className="relative block aspect-[4/5] bg-bg-card border-b border-border"
    >
      <Image
        src={video.thumbnail_url}
        alt={video.title || ""}
        fill
        sizes="430px"
        className="object-cover"
        loading="lazy"
      />
      <span className="absolute bottom-3 right-3 px-1.5 py-0.5 text-xs font-medium bg-black/70 text-white rounded">
        {formatDuration(video.duration_sec)}
      </span>
    </Link>
  );
}
