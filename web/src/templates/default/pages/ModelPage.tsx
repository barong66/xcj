// web/src/templates/default/pages/ModelPage.tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getAccountBySlug, getVideos } from "@/lib/api";
import { SITE_NAME, SITE_URL } from "@/lib/constants";
// Import from THIS template's own components so future templates can override visuals.
import { ProfileHeader } from "../ProfileHeader";
import { SimilarModels } from "../SimilarModels";
// Behavior components — not template-specific yet.
import { FanSiteButtons } from "@/app/model/[slug]/FanSiteButtons";
import { ProfileContent } from "@/app/model/[slug]/ProfileContent";
import { ProfileViewTracker } from "@/app/model/[slug]/ProfileViewTracker";
import { BreadcrumbJsonLd, ProfileJsonLd } from "@/components/JsonLd";
import { ErrorState } from "@/components/ErrorState";
import { AdLandingTracker } from "@/components/AdLandingTracker";
import { OnlyFansHeaderSetter } from "@/contexts/OnlyFansContext";

export interface ModelPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    page?: string;
    v?: string;
    src?: string;
    click_id?: string;
  }>;
}

export async function generateMetadata({
  params,
}: ModelPageProps): Promise<Metadata> {
  const { slug } = await params;
  try {
    const account = await getAccountBySlug(slug, 1, 1);
    const displayName = account.display_name || account.username;
    const cleanBio = account.bio?.replace(/\n+/g, " ").slice(0, 155);
    return {
      title: `${displayName} (@${account.username})`,
      description:
        cleanBio ||
        `Watch ${account.video_count || 0} videos from @${account.username} on ${SITE_NAME}.`,
      openGraph: {
        title: `${displayName} (@${account.username}) | ${SITE_NAME}`,
        description: cleanBio || `Videos from @${account.username}.`,
        url: `${SITE_URL}/model/${slug}`,
        images: account.avatar_url ? [{ url: account.avatar_url }] : undefined,
      },
      twitter: {
        card: "summary_large_image",
        title: `${displayName} (@${account.username}) | ${SITE_NAME}`,
        description: cleanBio || `Videos from @${account.username}.`,
        images: account.avatar_url ? [account.avatar_url] : undefined,
      },
      alternates: { canonical: `${SITE_URL}/model/${slug}` },
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
    if (!account || !account.id) notFound();

    const totalPages = Math.ceil((account.video_count || 0) / perPage);
    const videos = account.videos || [];
    const showSocialButtons =
      account.site_config?.show_social_buttons !== false;

    const ofRaw = account.social_links?.onlyfans;
    const onlyfansUrl = ofRaw
      ? ofRaw.startsWith("http")
        ? ofRaw
        : `https://onlyfans.com/${ofRaw}`
      : null;

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
        <OnlyFansHeaderSetter
          url={onlyfansUrl}
          username={account.username}
          displayName={account.display_name || account.username}
          avatarUrl={account.avatar_url || null}
        />
        {sp.src && <AdLandingTracker source={sp.src} clickId={sp.click_id} />}
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
        {similarVideos.length > 0 && <SimilarModels videos={similarVideos} />}
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
