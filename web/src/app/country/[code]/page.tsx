import type { Metadata } from "next";
import { Suspense } from "react";
import { getVideos } from "@/lib/api";
import { SITE_NAME, SITE_URL } from "@/lib/constants";
import type { SortOption } from "@/types";
import { InfiniteVideoGrid } from "@/components/InfiniteVideoGrid";
import { SortControls } from "@/components/SortControls";
import { PageTitle } from "@/components/PageTitle";
import { BreadcrumbJsonLd } from "@/components/JsonLd";
import { ErrorState } from "@/components/ErrorState";

interface CountryPageProps {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ sort?: string; page?: string }>;
}

const COUNTRY_NAMES: Record<string, string> = {
  US: "United States",
  GB: "United Kingdom",
  CA: "Canada",
  AU: "Australia",
  DE: "Germany",
  FR: "France",
  JP: "Japan",
  BR: "Brazil",
  IN: "India",
  MX: "Mexico",
  ES: "Spain",
  IT: "Italy",
  KR: "South Korea",
  RU: "Russia",
  NL: "Netherlands",
};

function getCountryName(code: string): string {
  return COUNTRY_NAMES[code.toUpperCase()] || code.toUpperCase();
}

export async function generateMetadata({
  params,
}: CountryPageProps): Promise<Metadata> {
  const { code } = await params;
  const countryName = getCountryName(code);

  return {
    title: `Videos from ${countryName}`,
    description: `Browse trending videos from ${countryName} on ${SITE_NAME}.`,
    openGraph: {
      title: `Videos from ${countryName} | ${SITE_NAME}`,
      description: `Browse trending videos from ${countryName}.`,
      url: `${SITE_URL}/country/${code}`,
    },
    alternates: {
      canonical: `${SITE_URL}/country/${code}`,
    },
  };
}

export default async function CountryPage({
  params,
  searchParams,
}: CountryPageProps) {
  const { code } = await params;
  const sp = await searchParams;
  const sort = (sp.sort as SortOption) || "recent";
  const page = parseInt(sp.page || "1", 10);
  const countryName = getCountryName(code);

  try {
    const data = await getVideos({
      country: code.toUpperCase(),
      sort,
      page,
      per_page: 24,
    });

    return (
      <>
        <BreadcrumbJsonLd
          items={[
            { name: "Home", url: "/" },
            { name: countryName, url: `/country/${code}` },
          ]}
        />
        <PageTitle
          title={`Videos from ${countryName}`}
          subtitle={`Trending content from ${countryName}`}
        >
          <Suspense fallback={null}>
            <SortControls currentSort={sort} />
          </Suspense>
        </PageTitle>
        <InfiniteVideoGrid
          initialVideos={data.videos}
          initialPage={data.page}
          totalPages={data.pages}
          sort={sort}
          country={code.toUpperCase()}
        />
      </>
    );
  } catch {
    return (
      <ErrorState message={`Could not load videos for ${countryName}.`} />
    );
  }
}
