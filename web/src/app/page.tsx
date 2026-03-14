// web/src/app/page.tsx
import type { Metadata } from "next";
import { loadTemplatePage } from "@/templates/_shared/loader";

export async function generateMetadata(): Promise<Metadata> {
  const mod = await loadTemplatePage("home");
  return mod.generateMetadata?.() ?? {};
}

export default async function Page(
  props: { searchParams: Promise<{ sort?: string; page?: string; anchor?: string; src?: string }> }
) {
  const mod = await loadTemplatePage("home");
  const HomePage = mod.default;
  return <HomePage {...props} />;
}
