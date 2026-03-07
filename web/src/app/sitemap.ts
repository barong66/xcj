import type { MetadataRoute } from "next";
import { getCategories, getVideos, getAccounts } from "@/lib/api";
import { SITE_URL } from "@/lib/constants";

const COUNTRY_CODES = [
  "US", "GB", "CA", "AU", "DE", "FR", "JP", "BR",
  "IN", "MX", "ES", "IT", "KR", "RU", "NL",
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: "hourly",
      priority: 1,
    },
    {
      url: `${SITE_URL}/categories`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.7,
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

  // Add model/account profile pages
  try {
    const accounts = await getAccounts();
    for (const account of accounts) {
      entries.push({
        url: `${SITE_URL}/model/${account.slug || account.username}`,
        lastModified: new Date(),
        changeFrequency: "daily",
        priority: 0.7,
      });
    }
  } catch {
    // Skip accounts if API unavailable
  }

  // Add country pages
  for (const code of COUNTRY_CODES) {
    entries.push({
      url: `${SITE_URL}/country/${code}`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.6,
    });
  }

  // Add recent video pages (up to 500 videos across 5 pages)
  try {
    for (let page = 1; page <= 5; page++) {
      const result = await getVideos({ sort: "recent", per_page: 100, page });
      for (const video of result.videos) {
        entries.push({
          url: `${SITE_URL}/video/${video.id}`,
          lastModified: video.published_at ? new Date(video.published_at) : new Date(),
          changeFrequency: "weekly",
          priority: 0.5,
        });
      }
      if (page >= result.pages) break;
    }
  } catch {
    // Skip videos if API unavailable
  }

  return entries;
}
