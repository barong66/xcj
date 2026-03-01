export interface Account {
  id: number;
  username: string;
  slug: string;
  display_name: string;
  avatar_url: string;
  bio?: string;
  social_links?: Record<string, string>;
  platform: "twitter" | "instagram";
  is_paid: boolean;
  video_count?: number;
  videos?: Video[];
}

export interface Category {
  slug: string;
  name: string;
  video_count?: number;
}

export interface Country {
  code: string;
  name: string;
}

export interface Video {
  id: string;
  title: string;
  thumbnail_url: string;
  preview_url: string;
  original_url: string;
  platform: "twitter" | "instagram";
  duration_sec: number;
  width: number;
  height: number;
  view_count: number;
  click_count: number;
  published_at?: string;
  account: Account;
  categories: Category[];
  country: Country;
}

export interface VideosResponse {
  videos: Video[];
  total: number;
  page: number;
  per_page: number;
  pages: number;
}

/** The API returns Account directly, with videos and video_count embedded. */
export type AccountResponse = Account;

export interface CategoriesResponse extends Array<Category> {}

export type SortOption = "recent" | "popular" | "random";

export interface VideoQueryParams {
  category?: string;
  country?: string;
  sort?: SortOption;
  page?: number;
  per_page?: number;
  anchor?: string;
  src?: string;
}

export interface SearchParams {
  q: string;
  page?: number;
  per_page?: number;
}

export type AnalyticsEventType =
  | "view"
  | "click"
  | "hover"
  | "impression"
  | "feed_impression"
  | "feed_click"
  | "profile_view"
  | "profile_thumb_impression"
  | "profile_thumb_click"
  | "social_click"
  | "share_click"
  | "ad_landing";

export interface AnalyticsEvent {
  type: AnalyticsEventType;
  video_id?: string;
  account_id?: number;
  target_url?: string;
  source_page?: string;
  source?: string;
  timestamp?: number;
}
