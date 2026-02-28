import type { Metadata } from "next";
import { Suspense } from "react";
import { getVideos, getCategories } from "@/lib/api";
import { SITE_NAME, SITE_URL } from "@/lib/constants";
import type { SortOption } from "@/types";
import { VideoGrid } from "@/components/VideoGrid";
import { SortControls } from "@/components/SortControls";
import { LoadMoreButton } from "@/components/LoadMoreButton";
import { BreadcrumbJsonLd } from "@/components/JsonLd";
import { ErrorState } from "@/components/ErrorState";

interface CategoryPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ sort?: string; page?: string }>;
}

export async function generateMetadata({
  params,
}: CategoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  let categoryName = slug.replace(/-/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());

  try {
    const categories = await getCategories();
    const match = categories.find((c) => c.slug === slug);
    if (match) categoryName = match.name;
  } catch {
    // Use slug-derived name
  }

  return {
    title: `${categoryName} Videos`,
    description: `Browse ${categoryName} videos from Twitter and Instagram on ${SITE_NAME}.`,
    openGraph: {
      title: `${categoryName} Videos | ${SITE_NAME}`,
      description: `Browse ${categoryName} videos from Twitter and Instagram.`,
      url: `${SITE_URL}/category/${slug}`,
    },
    alternates: {
      canonical: `${SITE_URL}/category/${slug}`,
    },
  };
}

export default async function CategoryPage({
  params,
  searchParams,
}: CategoryPageProps) {
  const { slug } = await params;
  const sp = await searchParams;
  const sort = (sp.sort as SortOption) || "recent";
  const page = parseInt(sp.page || "1", 10);

  let categoryName = slug.replace(/-/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());

  try {
    const categories = await getCategories();
    const match = categories.find((c) => c.slug === slug);
    if (match) categoryName = match.name;
  } catch {
    // Use slug-derived name
  }

  try {
    const data = await getVideos({ category: slug, sort, page, per_page: 12 });

    return (
      <>
        <BreadcrumbJsonLd
          items={[
            { name: "Home", url: "/" },
            { name: categoryName, url: `/category/${slug}` },
          ]}
        />
        <div className="px-4 py-3 border-b border-border">
          <p className="text-[15px] font-semibold text-txt">{categoryName}</p>
          <p className="text-[13px] text-txt-muted mt-0.5">
            {data.total} video{data.total !== 1 ? "s" : ""}
          </p>
        </div>
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
    return <ErrorState message={`Could not load videos for category "${categoryName}".`} />;
  }
}
