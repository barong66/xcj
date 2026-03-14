// web/src/app/search/page.tsx
import type { Metadata } from "next";
import { loadTemplatePage } from "@/templates/_shared/loader";

interface SearchPageProps {
  searchParams: Promise<{ q?: string; page?: string }>;
}

export async function generateMetadata(props: SearchPageProps): Promise<Metadata> {
  const mod = await loadTemplatePage("search");
  return mod.generateMetadata?.(props) ?? {};
}

export default async function Page(props: SearchPageProps) {
  const mod = await loadTemplatePage("search");
  const SearchPage = mod.default;
  return <SearchPage {...props} />;
}
