// web/src/app/model/[slug]/page.tsx
import type { Metadata } from "next";
import { loadTemplatePage } from "@/templates/_shared/loader";

interface ModelPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    page?: string;
    v?: string;
    src?: string;
    click_id?: string;
  }>;
}

export async function generateMetadata(props: ModelPageProps): Promise<Metadata> {
  const mod = await loadTemplatePage("model");
  return mod.generateMetadata?.(props) ?? {};
}

export default async function Page(props: ModelPageProps) {
  const mod = await loadTemplatePage("model");
  const ModelPage = mod.default;
  return <ModelPage {...props} />;
}
