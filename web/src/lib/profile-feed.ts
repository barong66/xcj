// web/src/lib/profile-feed.ts
// SERVER-SIDE ONLY — uses getVideos() which calls next/headers internally.
import type { Account, Video } from "@/types";
import type {
  FeedRule,
  FeedItem,
  FeedSort,
  SimilarityStrategy,
} from "@/lib/feed-types";

// Assembles the profile page feed from an ordered list of FeedRules.
//
// Rules are applied in order. Each rule selects up to `count` videos
// from its source, deduplicating against all previously selected videos.
//
// External fetches (non-current_model) are fired in parallel before assembly.
//
// Usage:
//   const items = await buildProfileFeed(account, "536", rules, strategy);
//   const videos = items.map(item => item.video);
export async function buildProfileFeed(
  account: Account,
  triggerVideoId: string | null,
  rules: FeedRule[],
  similarityStrategy: SimilarityStrategy
): Promise<FeedItem[]> {
  const usedIds = new Set<string>();
  const result: FeedItem[] = [];

  // Fire all external (non-current_model) fetches in parallel.
  const externalRules = rules.filter((r) => r.source !== "current_model");
  const externalVideos = await Promise.all(
    externalRules.map((rule) =>
      fetchExternal(rule, account, similarityStrategy)
    )
  );
  const externalMap = new Map<FeedRule, Video[]>();
  externalRules.forEach((rule, i) => externalMap.set(rule, externalVideos[i]));

  // Assemble in rule order.
  for (const rule of rules) {
    let candidates: Video[];

    if (rule.source === "current_model") {
      if (rule.sort === "trigger_first") {
        // The video the user clicked. If not in first page, produces 0 items.
        const found = (account.videos || []).find(
          (v) => String(v.id) === triggerVideoId
        );
        candidates = found ? [found] : [];
      } else {
        // Sort account's videos, excluding already-used ones.
        const available = (account.videos || []).filter(
          (v) => !usedIds.has(v.id)
        );
        candidates = sortVideos(available, rule.sort);
      }
    } else {
      candidates = (externalMap.get(rule) || []).filter(
        (v) => !usedIds.has(v.id)
      );
    }

    const toAdd = candidates.slice(0, rule.count);
    for (const video of toAdd) {
      usedIds.add(video.id);
      result.push({ video, ruleSource: rule.source });
    }
  }

  return result;
}

// Applies per-site overrides from site_config onto the template's default rules.
// Overridable keys: profile_model_count, profile_similar_count, profile_similar_sort.
export function applyFeedOverrides(
  rules: FeedRule[],
  siteConfig: Record<string, unknown>
): FeedRule[] {
  return rules.map((rule) => {
    if (rule.source === "current_model" && rule.sort !== "trigger_first") {
      const count = siteConfig.profile_model_count;
      if (typeof count === "number" && count > 0) {
        return { ...rule, count };
      }
    }
    if (rule.source === "similar_category") {
      const count = siteConfig.profile_similar_count;
      const sort = siteConfig.profile_similar_sort as FeedSort | undefined;
      return {
        ...rule,
        ...(typeof count === "number" && count > 0 ? { count } : {}),
        ...(sort ? { sort } : {}),
      };
    }
    return rule;
  });
}

function sortVideos(videos: Video[], sort: FeedSort): Video[] {
  if (sort === "popular") {
    return [...videos].sort(
      (a, b) => (b.view_count || 0) - (a.view_count || 0)
    );
  }
  if (sort === "recent") {
    return [...videos].sort((a, b) => {
      const ta = a.published_at ? new Date(a.published_at).getTime() : 0;
      const tb = b.published_at ? new Date(b.published_at).getTime() : 0;
      return tb - ta;
    });
  }
  if (sort === "random_popular") {
    const sorted = [...videos].sort(
      (a, b) => (b.view_count || 0) - (a.view_count || 0)
    );
    const top = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 2)));
    return top.sort(() => Math.random() - 0.5);
  }
  // trigger_first handled by caller; ctr not yet implemented → fall back to popular
  return [...videos].sort(
    (a, b) => (b.view_count || 0) - (a.view_count || 0)
  );
}

async function fetchExternal(
  rule: FeedRule,
  account: Account,
  similarityStrategy: SimilarityStrategy
): Promise<Video[]> {
  if (rule.source === "similar_category") {
    try {
      return await similarityStrategy.fetch(
        account,
        rule.count,
        rule.sort,
        rule.filters || []
      );
    } catch {
      return [];
    }
  }
  // same_country, trending: not implemented in v1
  return [];
}
