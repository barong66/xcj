import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getAccountBySlug } from "@/lib/api";
import { SITE_NAME, SITE_URL } from "@/lib/constants";
import { ProfileHeader } from "./ProfileHeader";
import { FanSiteButtons } from "./FanSiteButtons";
import { ProfileContent } from "./ProfileContent";
import { ProfileViewTracker } from "./ProfileViewTracker";
import { BreadcrumbJsonLd, ProfileJsonLd } from "@/components/JsonLd";
import { ErrorState } from "@/components/ErrorState";

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

        <Suspense fallback={null}>
          <FanSiteButtons account={account} />
        </Suspense>

        <ProfileContent
          account={account}
          initialVideos={videos}
          totalPages={totalPages}
          slug={slug}
          perPage={perPage}
        />
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
