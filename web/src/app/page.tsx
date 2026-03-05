import type { Metadata } from "next";
import { Suspense } from "react";
import { getVideos } from "@/lib/api";
import { SITE_NAME } from "@/lib/constants";
import type { SortOption } from "@/types";
import { InfiniteVideoGrid } from "@/components/InfiniteVideoGrid";
import { SortControls } from "@/components/SortControls";
import { WebsiteJsonLd } from "@/components/JsonLd";
import { ErrorState } from "@/components/ErrorState";
import { AdLandingTracker } from "@/components/AdLandingTracker";
import { ProfileStories } from "@/components/ProfileStories";

export const metadata: Metadata = {
  title: `${SITE_NAME} - Trending Videos from Twitter & Instagram`,
  description:
    "Discover the latest trending videos from Twitter and Instagram. Browse by category, filter by country, and watch previews instantly.",
};

interface HomePageProps {
  searchParams: Promise<{ sort?: string; page?: string; anchor?: string; src?: string }>;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const sort = (params.sort as SortOption) || "recent";
  const page = parseInt(params.page || "1", 10);
  const anchor = params.anchor || "";
  const src = params.src || "";

  try {
    const data = await getVideos({ sort, page, per_page: 12, anchor: anchor || undefined, src: src || undefined });

    return (
      <>
        <WebsiteJsonLd searchUrl="/search" />
        {src && <AdLandingTracker source={src} anchor={anchor} />}
        {!anchor && (
          <Suspense fallback={null}>
            <ProfileStories />
          </Suspense>
        )}
        {!anchor && (
          <div className="px-4 py-2">
            <Suspense fallback={null}>
              <SortControls currentSort={sort} />
            </Suspense>
          </div>
        )}
        <InfiniteVideoGrid
          initialVideos={data.videos}
          initialPage={data.page}
          totalPages={data.pages}
          sort={sort}
          anchor={anchor || undefined}
          src={src || undefined}
        />
      </>
    );
  } catch {
    return <ErrorState message="Could not load videos. The API server may be unavailable." />;
  }
}
