import type { Metadata } from "next";
import Link from "next/link";
import { getCategories } from "@/lib/api";
import { SITE_NAME, SITE_URL } from "@/lib/constants";
import { ErrorState } from "@/components/ErrorState";

export const metadata: Metadata = {
  title: `Categories`,
  description: `Browse all video categories on ${SITE_NAME}. Find trending content from Twitter and Instagram by topic.`,
  alternates: {
    canonical: `${SITE_URL}/categories`,
  },
};

export default async function CategoriesPage() {
  let categories;
  try {
    categories = await getCategories();
  } catch {
    return <ErrorState message="Could not load categories." />;
  }

  return (
    <div className="px-4 pt-4">
      <h1 className="text-[15px] font-semibold text-txt mb-4">Browse Categories</h1>
      <div className="grid grid-cols-2 gap-2">
        {categories.map((cat) => (
          <Link
            key={cat.slug}
            href={`/category/${cat.slug}`}
            className="flex items-center justify-between px-4 py-3.5 bg-bg-card rounded-xl border border-border hover:bg-bg-hover transition-colors"
          >
            <span className="text-[14px] font-medium text-txt">{cat.name}</span>
            {cat.video_count !== undefined && (
              <span className="text-[12px] text-txt-muted">
                {cat.video_count}
              </span>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
