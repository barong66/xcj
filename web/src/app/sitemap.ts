import type { MetadataRoute } from "next";
import { getCategories, getVideos } from "@/lib/api";
import { SITE_URL } from "@/lib/constants";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: "hourly",
      priority: 1,
    },
  ];

  // Add category pages
  try {
    const categories = await getCategories();
    for (const cat of categories) {
      entries.push({
        url: `${SITE_URL}/category/${cat.slug}`,
        lastModified: new Date(),
        changeFrequency: "daily",
        priority: 0.8,
      });
    }
  } catch {
    // Skip categories if API unavailable
  }

  // Add recent video pages (first few pages)
  try {
    const recentVideos = await getVideos({ sort: "recent", per_page: 100, page: 1 });
    for (const video of recentVideos.videos) {
      entries.push({
        url: `${SITE_URL}/video/${video.id}`,
        lastModified: new Date(),
        changeFrequency: "weekly",
        priority: 0.6,
      });
    }
  } catch {
    // Skip videos if API unavailable
  }

  return entries;
}
