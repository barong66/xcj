import { headers } from "next/headers";
import type {
  Video,
  VideosResponse,
  AccountResponse,
  Category,
  VideoQueryParams,
  SearchParams,
} from "@/types";

const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

async function fetchAPI<T>(path: string, options?: RequestInit): Promise<T> {
  // Forward the browser's Host header so Go API can detect the site.
  const headersList = await headers();
  const host = headersList.get("host") || "";

  const url = `${API_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-Host": host,
      ...options?.headers,
    },
  });

  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText} for ${url}`);
  }

  return res.json();
}

export async function getVideos(params: VideoQueryParams = {}): Promise<VideosResponse> {
  const searchParams = new URLSearchParams();
  if (params.category) searchParams.set("category", params.category);
  if (params.country) searchParams.set("country", params.country);
  if (params.sort) searchParams.set("sort", params.sort);
  if (params.page) searchParams.set("page", String(params.page));
  if (params.per_page) searchParams.set("per_page", String(params.per_page));
  if (params.anchor) searchParams.set("anchor", params.anchor);
  if (params.src) searchParams.set("src", params.src);
  if (params.exclude_account_id) searchParams.set("exclude_account_id", String(params.exclude_account_id));

  const qs = searchParams.toString();
  return fetchAPI<VideosResponse>(`/api/v1/videos${qs ? `?${qs}` : ""}`);
}

export async function getVideo(id: string): Promise<Video> {
  return fetchAPI<Video>(`/api/v1/videos/${id}`);
}

export async function getCategories(): Promise<Category[]> {
  const data = await fetchAPI<Category[] | { categories: Category[] }>("/api/v1/categories");
  return Array.isArray(data) ? data : data.categories || [];
}

export async function searchVideos(params: SearchParams): Promise<VideosResponse> {
  const searchParams = new URLSearchParams();
  searchParams.set("q", params.q);
  if (params.page) searchParams.set("page", String(params.page));
  if (params.per_page) searchParams.set("per_page", String(params.per_page));

  return fetchAPI<VideosResponse>(`/api/v1/search?${searchParams.toString()}`);
}

export async function getVideosByAccount(
  platform: string,
  username: string,
  page: number = 1,
  per_page: number = 24
): Promise<VideosResponse> {
  const searchParams = new URLSearchParams();
  searchParams.set("page", String(page));
  searchParams.set("per_page", String(per_page));

  return fetchAPI<VideosResponse>(
    `/api/v1/accounts/${platform}/${username}/videos?${searchParams.toString()}`
  );
}

export async function getAccountBySlug(
  slug: string,
  page: number = 1,
  per_page: number = 24,
): Promise<AccountResponse> {
  const searchParams = new URLSearchParams();
  searchParams.set("page", String(page));
  searchParams.set("per_page", String(per_page));

  return fetchAPI<AccountResponse>(
    `/api/v1/accounts/slug/${encodeURIComponent(slug)}?${searchParams.toString()}`,
  );
}

export async function getAllVideoIds(): Promise<string[]> {
  const result = await fetchAPI<{ ids: string[] }>("/api/v1/videos/ids");
  return result.ids;
}

export async function getAllCategorySlugs(): Promise<string[]> {
  const categories = await getCategories();
  return categories.map((c) => c.slug);
}
