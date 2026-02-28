import type { Metadata } from "next";
import { Suspense } from "react";
import { getVideos } from "@/lib/api";
import { SITE_NAME } from "@/lib/constants";
import type { SortOption } from "@/types";
import { VideoGrid } from "@/components/VideoGrid";
import { SortControls } from "@/components/SortControls";
import { LoadMoreButton } from "@/components/LoadMoreButton";
import { WebsiteJsonLd } from "@/components/JsonLd";
import { ErrorState } from "@/components/ErrorState";

export const metadata: Metadata = {
  title: `${SITE_NAME} - Trending Videos from Twitter & Instagram`,
  description:
    "Discover the latest trending videos from Twitter and Instagram. Browse by category, filter by country, and watch previews instantly.",
};

interface HomePageProps {
  searchParams: Promise<{ sort?: string; page?: string }>;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const sort = (params.sort as SortOption) || "recent";
  const page = parseInt(params.page || "1", 10);

  try {
    const data = await getVideos({ sort, page, per_page: 12 });

    return (
      <>
        <WebsiteJsonLd searchUrl="/search" />
        <div className="px-4 py-2">
          <Suspense fallback={null}>
            <SortControls currentSort={sort} />
          </Suspense>
        </div>
        <VideoGrid videos={data.videos} />
        <Suspense fallback={null}>
          <LoadMoreButton currentPage={data.page} totalPages={data.pages} />
        </Suspense>
      </>
    );
  } catch {
    return <ErrorState message="Could not load videos. The API server may be unavailable." />;
  }
}
