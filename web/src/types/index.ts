export interface Account {
  username: string;
  avatar_url: string;
  platform: "twitter" | "instagram";
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

export interface CategoriesResponse extends Array<Category> {}

export type SortOption = "recent" | "popular" | "random";

export interface VideoQueryParams {
  category?: string;
  country?: string;
  sort?: SortOption;
  page?: number;
  per_page?: number;
}

export interface SearchParams {
  q: string;
  page?: number;
  per_page?: number;
}

export interface AnalyticsEvent {
  type: "view" | "click" | "hover" | "impression";
  video_id: string;
  timestamp?: number;
}
