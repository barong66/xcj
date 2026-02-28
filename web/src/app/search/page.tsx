import type { Metadata } from "next";
import { Suspense } from "react";
import { searchVideos } from "@/lib/api";
import { SITE_NAME, SITE_URL } from "@/lib/constants";
import { VideoGrid } from "@/components/VideoGrid";
import { LoadMoreButton } from "@/components/LoadMoreButton";
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
    title: query ? `Search: ${query}` : "Search Videos",
    description: query
      ? `Search results for "${query}" on ${SITE_NAME}.`
      : `Search for videos on ${SITE_NAME}.`,
    openGraph: {
      title: query ? `Search: ${query} | ${SITE_NAME}` : `Search | ${SITE_NAME}`,
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
    return (
      <div className="px-4 pt-4">
        <Suspense fallback={null}>
          <SearchBar />
        </Suspense>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <svg
            className="w-16 h-16 text-txt-muted mb-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <p className="text-txt-secondary text-lg font-medium">Search</p>
          <p className="text-txt-muted text-sm mt-1">
            Find videos, accounts, and more
          </p>
        </div>
      </div>
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
        <VideoGrid videos={data.videos} />
        <Suspense fallback={null}>
          <LoadMoreButton currentPage={data.page} totalPages={data.pages} />
        </Suspense>
      </>
    );
  } catch {
    return <ErrorState message={`Could not search for "${query}".`} />;
  }
}
