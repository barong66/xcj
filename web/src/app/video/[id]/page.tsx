import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { getVideo, getVideos } from "@/lib/api";
import { SITE_NAME, SITE_URL } from "@/lib/constants";
import { formatViewCount, formatDuration } from "@/lib/utils";
import { InfiniteVideoGrid } from "@/components/InfiniteVideoGrid";
import { VideoJsonLd, BreadcrumbJsonLd } from "@/components/JsonLd";
import { PlatformIcon } from "@/components/PlatformIcon";
import { ViewTracker } from "@/components/ViewTracker";
import { VideoClickButton } from "./VideoClickButton";
import { ErrorState } from "@/components/ErrorState";

interface VideoPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({
  params,
}: VideoPageProps): Promise<Metadata> {
  const { id } = await params;

  try {
    const video = await getVideo(id);
    const platformLabel = video.platform === "twitter" ? "Twitter/X" : "Instagram";

    return {
      title: video.title,
      description: `Watch "${video.title}" by @${video.account.username} on ${platformLabel}. ${formatViewCount(video.view_count)} views.`,
      openGraph: {
        type: "video.other",
        title: video.title,
        description: `By @${video.account.username} on ${platformLabel}`,
        url: `${SITE_URL}/video/${id}`,
        images: [
          {
            url: video.thumbnail_url,
            width: 1280,
            height: 720,
            alt: video.title,
          },
        ],
        videos: [
          {
            url: video.preview_url,
            width: 1280,
            height: 720,
            type: "video/mp4",
          },
        ],
      },
      twitter: {
        card: "player",
        title: video.title,
        description: `By @${video.account.username} on ${platformLabel}`,
        images: [video.thumbnail_url],
      },
      alternates: {
        canonical: `${SITE_URL}/video/${id}`,
      },
    };
  } catch {
    return {
      title: "Video Not Found",
      description: "The requested video could not be found.",
    };
  }
}

export default async function VideoPage({ params }: VideoPageProps) {
  const { id } = await params;

  let video;
  try {
    video = await getVideo(id);
  } catch {
    return (
      <ErrorState
        title="Video not found"
        message="This video may have been removed or is no longer available."
      />
    );
  }

  const platformLabel = video.platform === "twitter" ? "Twitter/X" : "Instagram";

  // Fetch related videos (from same category if available)
  let relatedVideos;
  try {
    const categorySlug = video.categories?.[0]?.slug;
    relatedVideos = await getVideos({
      category: categorySlug,
      per_page: 6,
      sort: "popular",
    });
    relatedVideos.videos = relatedVideos.videos.filter((v) => v.id !== video.id);
  } catch {
    relatedVideos = null;
  }

  return (
    <>
      <VideoJsonLd video={video} />
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: "/" },
          ...(video.categories?.[0]
            ? [
                {
                  name: video.categories[0].name,
                  url: `/category/${video.categories[0].slug}`,
                },
              ]
            : []),
          { name: video.title, url: `/video/${id}` },
        ]}
      />
      <ViewTracker videoId={video.id} />

      {/* Post header */}
      <div className="flex items-center gap-3 px-4 py-2.5">
        <Link
          href={`/account/${video.account.platform}/${video.account.username}`}
          className="shrink-0"
        >
          <div className="w-8 h-8 rounded-full overflow-hidden bg-bg-elevated">
            {video.account.avatar_url ? (
              <Image
                src={video.account.avatar_url}
                alt={video.account.username}
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
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <Link
            href={`/account/${video.account.platform}/${video.account.username}`}
            className="text-[13px] font-semibold text-txt"
          >
            {video.account.username}
          </Link>
          <span className="text-txt-muted text-[13px]">&middot;</span>
          <PlatformIcon platform={video.platform} size={12} />
          <span className="text-txt-muted text-[13px]">{platformLabel}</span>
        </div>
      </div>

      {/* Video thumbnail with play overlay */}
      <div className="relative aspect-[4/5] bg-bg-card">
        <Image
          src={video.thumbnail_url}
          alt={video.title}
          fill
          sizes="430px"
          className="object-cover"
          priority
        />
        <VideoClickButton
          videoId={video.id}
          originalUrl={video.original_url}
        />
        <span className="absolute bottom-3 right-3 px-1.5 py-0.5 text-xs font-medium bg-black/70 text-white rounded">
          {formatDuration(video.duration_sec)}
        </span>
      </div>

      {/* Actions + info */}
      <div className="px-4 py-3">
        <div className="flex items-center gap-4 text-txt-secondary text-[13px] mb-2">
          <span>{formatViewCount(video.view_count)} views</span>
          <span className="text-txt-muted">&middot;</span>
          <span>{formatViewCount(video.click_count)} clicks</span>
          {video.country && (
            <>
              <span className="text-txt-muted">&middot;</span>
              <Link
                href={`/country/${video.country.code}`}
                className="hover:text-txt transition-colors"
              >
                {video.country.name}
              </Link>
            </>
          )}
        </div>

        <h1 className="text-[15px] font-semibold text-txt leading-snug mb-1">
          {video.title}
        </h1>

        {video.categories && video.categories.length > 0 && (
          <p className="text-[13px] text-accent">
            {video.categories.map((cat) => (
              <Link
                key={cat.slug}
                href={`/category/${cat.slug}`}
                className="hover:underline mr-1.5"
              >
                #{cat.name.toLowerCase().replace(/\s+/g, "")}
              </Link>
            ))}
          </p>
        )}

        {/* Open original button */}
        <a
          href={video.original_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 flex items-center justify-center gap-2 w-full py-2.5 text-[13px] font-semibold bg-accent text-white rounded-lg hover:bg-accent-hover transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
          View on {platformLabel}
        </a>
      </div>

      {/* Related videos */}
      {relatedVideos && relatedVideos.videos.length > 0 && (
        <div className="border-t border-border mt-2">
          <p className="px-4 py-3 text-[13px] font-semibold text-txt">
            More like this
          </p>
          <InfiniteVideoGrid
            initialVideos={relatedVideos.videos.slice(0, 6)}
            initialPage={1}
            totalPages={1}
          />
        </div>
      )}
    </>
  );
}
