import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getAccountBySlug, getVideos } from "@/lib/api";
import { SITE_NAME, SITE_URL } from "@/lib/constants";
import { ProfileHeader } from "./ProfileHeader";
import { FanSiteButtons } from "./FanSiteButtons";
import { ProfileContent } from "./ProfileContent";
import { ProfileViewTracker } from "./ProfileViewTracker";
import { BreadcrumbJsonLd, ProfileJsonLd } from "@/components/JsonLd";
import { ErrorState } from "@/components/ErrorState";
import { SimilarModels } from "./SimilarModels";

interface ModelPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string; v?: string; u?: string }>;
}

export async function generateMetadata({
  params,
}: ModelPageProps): Promise<Metadata> {
  const { slug } = await params;

  try {
    const account = await getAccountBySlug(slug, 1, 1);
    const displayName = account.display_name || account.username;

    return {
      title: `${displayName} (@${account.username})`,
      description:
        account.bio ||
        `Watch ${account.video_count || 0} videos from @${account.username} on ${SITE_NAME}.`,
      openGraph: {
        title: `${displayName} (@${account.username}) | ${SITE_NAME}`,
        description:
          account.bio ||
          `Videos from @${account.username}.`,
        url: `${SITE_URL}/model/${slug}`,
        images: account.avatar_url ? [{ url: account.avatar_url }] : undefined,
      },
      alternates: {
        canonical: `${SITE_URL}/model/${slug}`,
      },
    };
  } catch {
    return { title: `@${slug}` };
  }
}

export default async function ModelPage({
  params,
  searchParams,
}: ModelPageProps) {
  const { slug } = await params;
  const sp = await searchParams;
  const perPage = 24;

  try {
    const account = await getAccountBySlug(slug, 1, perPage);

    if (!account || !account.id) {
      notFound();
    }

    const totalPages = Math.ceil((account.video_count || 0) / perPage);
    const videos = account.videos || [];
    const showSocialButtons = account.site_config?.show_social_buttons !== false;

    // For free accounts, fetch similar models from the same category.
    let similarVideos: import("@/types").Video[] = [];
    if (!account.is_paid && videos.length > 0) {
      const topCategory = videos[0]?.categories?.[0]?.slug;
      if (topCategory) {
        try {
          const related = await getVideos({
            category: topCategory,
            exclude_account_id: account.id,
            per_page: 9,
            sort: "popular",
          });
          similarVideos = related.videos || [];
        } catch {
          // Silently fail — similar models section is optional.
        }
      }
    }

    return (
      <>
        <BreadcrumbJsonLd
          items={[
            { name: "Home", url: "/" },
            {
              name: account.display_name || `@${account.username}`,
              url: `/model/${slug}`,
            },
          ]}
        />
        <ProfileJsonLd account={account} />
        <ProfileViewTracker accountId={account.id} />

        <ProfileHeader account={account} />

        {showSocialButtons && (
          <Suspense fallback={null}>
            <FanSiteButtons account={account} />
          </Suspense>
        )}

        <ProfileContent
          account={account}
          initialVideos={videos}
          totalPages={totalPages}
          slug={slug}
          perPage={perPage}
        />

        {similarVideos.length > 0 && (
          <SimilarModels videos={similarVideos} />
        )}
      </>
    );
  } catch {
    return (
      <ErrorState
        title="Profile not found"
        message={`Could not load profile for @${slug}.`}
      />
    );
  }
}
