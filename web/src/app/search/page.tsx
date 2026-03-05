import type { Metadata } from "next";
import { Suspense } from "react";
import { searchVideos, getCategories, getVideos } from "@/lib/api";
import { SITE_NAME, SITE_URL } from "@/lib/constants";
import { InfiniteVideoGrid } from "@/components/InfiniteVideoGrid";
import { ExploreGrid } from "@/components/ExploreGrid";
import { CategoryGrid } from "@/components/CategoryGrid";
import { SearchBar } from "@/components/SearchBar";
import { ErrorState } from "@/components/ErrorState";

interface SearchPageProps {
  searchParams: Promise<{ q?: string; page?: string }>;
}

export async function generateMetadata({
  searchParams,
}: SearchPageProps): Promise<Metadata> {
  const params = await searchParams;
  const query = params.q || "";

  return {
    title: query ? `Search: ${query}` : "Explore",
    description: query
      ? `Search results for "${query}" on ${SITE_NAME}.`
      : `Explore trending videos on ${SITE_NAME}.`,
    openGraph: {
      title: query ? `Search: ${query} | ${SITE_NAME}` : `Explore | ${SITE_NAME}`,
      url: `${SITE_URL}/search${query ? `?q=${encodeURIComponent(query)}` : ""}`,
    },
    robots: {
      index: false,
      follow: true,
    },
  };
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const query = params.q || "";
  const page = parseInt(params.page || "1", 10);

  if (!query) {
    let categories;
    let videos;
    try {
      [categories, videos] = await Promise.all([
        getCategories(),
        getVideos({ sort: "random", per_page: 12 }),
      ]);
    } catch {
      return <ErrorState message="Could not load explore page." />;
    }

    return (
      <>
        <div className="px-4 pt-4 pb-3">
          <Suspense fallback={null}>
            <SearchBar />
          </Suspense>
        </div>

        <CategoryGrid categories={categories} />

        <ExploreGrid
          initialVideos={videos.videos}
          initialPage={videos.page}
          totalPages={videos.pages}
        />
      </>
    );
  }

  try {
    const data = await searchVideos({ q: query, page, per_page: 12 });

    return (
      <>
        <div className="px-4 pt-4 pb-2">
          <Suspense fallback={null}>
            <SearchBar />
          </Suspense>
          <p className="text-txt-muted text-[13px] mt-3">
            {data.total} result{data.total !== 1 ? "s" : ""} for &ldquo;{query}&rdquo;
          </p>
        </div>
        <InfiniteVideoGrid
          initialVideos={data.videos}
          initialPage={data.page}
          totalPages={data.pages}
          searchQuery={query}
        />
      </>
    );
  } catch {
    return <ErrorState message={`Could not search for "${query}".`} />;
  }
}
