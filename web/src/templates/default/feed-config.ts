import type { FeedRule } from "@/lib/feed-types";
import { SameCategoryStrategy } from "@/lib/similarity/same-category";

/**
 * Default profile feed rules for the "default" template.
 *
 * Rule evaluation order:
 * 1. First video from current model matching the trigger (clicked video)
 * 2. Five recent videos from current model
 * 3. Nine popular videos from similar models (same category)
 *
 * These defaults can be overridden per-site via site_config in the DB
 * using applyFeedOverrides() from profile-feed.ts.
 */
export const profileFeedRules: FeedRule[] = [
  { source: "current_model", sort: "trigger_first", count: 1 },
  { source: "current_model", sort: "recent",        count: 5 },
  { source: "similar_category", sort: "popular",    count: 9 },
];

export const similarityStrategy = new SameCategoryStrategy();
