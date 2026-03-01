import type { Metadata } from "next";
import Image from "next/image";
import { getVideosByAccount } from "@/lib/api";
import { SITE_NAME, SITE_URL } from "@/lib/constants";
import { InfiniteVideoGrid } from "@/components/InfiniteVideoGrid";
import { BreadcrumbJsonLd } from "@/components/JsonLd";
import { PlatformIcon } from "@/components/PlatformIcon";
import { ErrorState } from "@/components/ErrorState";

interface AccountPageProps {
  params: Promise<{ platform: string; username: string }>;
  searchParams: Promise<{ page?: string }>;
}

export async function generateMetadata({
  params,
}: AccountPageProps): Promise<Metadata> {
  const { platform, username } = await params;
  const platformLabel = platform === "twitter" ? "Twitter/X" : "Instagram";

  return {
    title: `@${username} on ${platformLabel}`,
    description: `Watch videos from @${username} on ${platformLabel}. Browse their content on ${SITE_NAME}.`,
    openGraph: {
      title: `@${username} on ${platformLabel} | ${SITE_NAME}`,
      description: `Videos from @${username} on ${platformLabel}.`,
      url: `${SITE_URL}/account/${platform}/${username}`,
    },
    alternates: {
      canonical: `${SITE_URL}/account/${platform}/${username}`,
    },
  };
}

export default async function AccountPage({
  params,
  searchParams,
}: AccountPageProps) {
  const { platform, username } = await params;
  const sp = await searchParams;
  const page = parseInt(sp.page || "1", 10);
  const platformLabel = platform === "twitter" ? "Twitter/X" : "Instagram";

  try {
    const data = await getVideosByAccount(platform, username, page, 12);

    // Get avatar from first video if available
    const avatarUrl = data.videos[0]?.account?.avatar_url;

    return (
      <>
        <BreadcrumbJsonLd
          items={[
            { name: "Home", url: "/" },
            { name: `@${username}`, url: `/account/${platform}/${username}` },
          ]}
        />

        {/* Profile header — Instagram style */}
        <div className="px-4 py-4 border-b border-border">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full overflow-hidden bg-bg-elevated shrink-0">
              {avatarUrl ? (
                <Image
                  src={avatarUrl}
                  alt={username}
                  width={64}
                  height={64}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <PlatformIcon platform={platform} size={28} />
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[16px] font-semibold text-txt">@{username}</p>
              <p className="text-[13px] text-txt-muted mt-0.5">
                {data.total} video{data.total !== 1 ? "s" : ""} &middot; {platformLabel}
              </p>
            </div>
          </div>
        </div>

        <InfiniteVideoGrid
          initialVideos={data.videos}
          initialPage={data.page}
          totalPages={data.pages}
          fetchUrlOverride={`/api/v1/accounts/${platform}/${username}/videos?per_page=12`}
        />
      </>
    );
  } catch {
    return (
      <ErrorState
        title={`@${username} not found`}
        message={`Could not load videos for @${username} on ${platformLabel}.`}
      />
    );
  }
}
