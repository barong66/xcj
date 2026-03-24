import { getVideos } from "@/lib/api";
import type { Account, Video } from "@/types";
import type { FeedSort, FeedFilter, SimilarityStrategy } from "@/lib/feed-types";

// Finds videos from other models that share the same top category
// as the first video of the current account.
// - Deduplicates by account: shows at most 1 video per other model.
// - For "random_popular": fetches 4x count from API, shuffles, slices.
export class SameCategoryStrategy implements SimilarityStrategy {
  async fetch(
    account: Account,
    count: number,
    sort: FeedSort,
    _filters: FeedFilter[]
  ): Promise<Video[]> {
    const topCategory = account.top_categories?.[0]?.slug;
    if (!topCategory) return [];

    // "ctr" and "random_popular" are not direct API params — map to "popular".
    // "random_popular" fetches more and shuffles below.
    const apiSort =
      sort === "recent" ? "recent" : "popular";
    const fetchCount =
      sort === "random_popular" ? Math.min(count * 4, 60) : count * 2;

    const result = await getVideos({
      category: topCategory,
      exclude_account_id: account.id,
      per_page: fetchCount,
      sort: apiSort,
    });

    let videos = result.videos || [];

    // Deduplicate: one video per unique account.
    const seen = new Set<number>();
    videos = videos.filter((v) => {
      const aid = v.account?.id;
      if (!aid || seen.has(aid)) return false;
      seen.add(aid);
      return true;
    });

    // Shuffle for random_popular, then take count.
    if (sort === "random_popular") {
      videos = videos.sort(() => Math.random() - 0.5);
    }

    return videos.slice(0, count);
  }
}
