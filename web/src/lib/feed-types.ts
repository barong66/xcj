import type { Account, Video } from "@/types";

export type FeedSource =
  | "current_model"
  | "similar_category"
  | "same_country"   // future
  | "trending";      // future

export type FeedSort =
  | "trigger_first"
  | "recent"
  | "popular"
  | "ctr"           // future: requires ClickHouse
  | "random_popular";

export type FeedFilter =
  | { type: "account_type"; value: "free" | "paid" }
  | { type: "country"; value: string[] }
  | { type: "category"; value: string[] };
  // future: | { type: "language"; value: string[] }
  // future: | { type: "min_views"; value: number }

export interface FeedRule {
  source: FeedSource;
  sort: FeedSort;
  count: number;
  filters?: FeedFilter[];
}

export interface FeedItem {
  video: Video;
  // Which rule produced this item. Used for analytics / debugging.
  ruleSource: FeedSource;
}

// Pluggable interface for "find similar content".
// Implement this to swap in a new similarity algorithm without
// changing ProfileFeedBuilder.
export interface SimilarityStrategy {
  // account: full Account object — use .videos[0].categories, .id, etc.
  // count: max videos to return
  // sort: how to order (strategy maps to API params)
  // filters: additional constraints (passed through, wired per-filter in v2+)
  fetch(
    account: Account,
    count: number,
    sort: FeedSort,
    filters: FeedFilter[]
  ): Promise<Video[]>;
}
