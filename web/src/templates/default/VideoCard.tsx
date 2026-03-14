"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import type { Video } from "@/types";
import { formatDuration, formatViewCount, timeAgo } from "@/lib/utils";
import { trackFeedClick, trackFeedImpression } from "@/lib/analytics";
import { PlatformIcon } from "@/components/PlatformIcon";

interface VideoCardProps {
  video: Video;
  priority?: boolean;
}

export function VideoCard({ video, priority }: VideoCardProps) {
  const cardRef = useRef<HTMLElement>(null);
  const hasTrackedImpression = useRef(false);
  const router = useRouter();

  const modelSlug = video.account.slug || video.account.username;
  const modelHref = `/model/${modelSlug}?v=${video.id}`;

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !hasTrackedImpression.current) {
            trackFeedImpression(video.id);
            hasTrackedImpression.current = true;
            observer.disconnect();
          }
        }
      },
      { threshold: 0.5 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [video.id]);

  const handleOpen = useCallback(() => {
    trackFeedClick(video.id, video.account.id);
    router.push(modelHref);
  }, [video.id, video.account.id, modelHref, router]);

  return (
    <article ref={cardRef} className="border-b border-border">
      {/* Post header — avatar + username + platform + time */}
      <div className="flex items-center gap-3 px-4 py-2.5">
        <Link href={modelHref} className="shrink-0">
          <div className="w-8 h-8 rounded-full overflow-hidden bg-bg-elevated">
            {video.account.avatar_url ? (
              <Image
                src={video.account.avatar_url}
                alt=""
                width={32}
                height={32}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-txt-muted text-xs font-semibold">
                {video.account.username.charAt(0).toUpperCase()}
              </div>
            )}
          </div>
        </Link>

        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <Link
            href={modelHref}
            className="text-[13px] font-semibold text-txt truncate"
          >
            {video.account.username}
          </Link>
          <span className="text-txt-muted text-[13px]">&middot;</span>
          <span className="flex items-center gap-1 shrink-0">
            <PlatformIcon platform={video.platform} size={12} />
          </span>
          {video.published_at && (
            <>
              <span className="text-txt-muted text-[13px]">&middot;</span>
              <span className="text-txt-muted text-[13px] shrink-0">
                {timeAgo(video.published_at)}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Image — full width, Instagram 4:5 aspect */}
      <div
        className="relative aspect-[4/5] bg-bg-card cursor-pointer"
        onClick={handleOpen}
      >
        <Image
          src={video.thumbnail_url}
          alt={video.title}
          fill
          sizes="(max-width: 430px) 100vw, 430px"
          className="object-cover"
          {...(priority ? { priority: true } : { loading: "lazy" as const })}
        />

        {/* Duration badge */}
        <span className="absolute bottom-3 right-3 px-1.5 py-0.5 text-xs font-medium bg-black/70 text-white rounded">
          {formatDuration(video.duration_sec)}
        </span>
      </div>

      {/* Actions row */}
      <div className="flex items-center gap-4 px-4 pt-2.5 pb-1">
        {/* Views */}
        <span className="flex items-center gap-1.5 text-txt-secondary">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          <span className="text-[13px] font-medium">
            {formatViewCount(video.view_count)}
          </span>
        </span>

        {/* Share */}
        <button
          onClick={() => {
            if (navigator.share) {
              navigator.share({ url: modelHref, title: video.title });
            } else {
              navigator.clipboard.writeText(`${window.location.origin}${modelHref}`);
            }
          }}
          aria-label="Share"
          className="flex items-center gap-1.5 text-txt-secondary hover:text-txt transition-colors ml-auto"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>

      {/* Title + categories */}
      <div className="px-4 pb-3">
        <p className="text-[13px] text-txt leading-[18px]">
          <Link href={modelHref} className="font-semibold hover:underline">
            {video.account.username}
          </Link>{" "}
          {video.title}
        </p>
        {video.categories && video.categories.length > 0 && (
          <p className="text-[13px] text-accent mt-0.5">
            {video.categories.map((cat) => (
              <Link
                key={cat.slug}
                href={`/category/${cat.slug}`}
                className="hover:underline mr-1.5 inline-block py-1"
              >
                #{cat.name.toLowerCase().replace(/\s+/g, "")}
              </Link>
            ))}
          </p>
        )}
      </div>
    </article>
  );
}
