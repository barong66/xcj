"use client";

import { useState, useRef, useCallback, useEffect } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

interface UseInfiniteScrollOptions<T> {
  initialItems: T[];
  initialPage: number;
  totalPages: number;
  fetchUrl: string;
  extractItems: (data: Record<string, unknown>) => T[];
}

interface UseInfiniteScrollResult<T> {
  items: T[];
  sentinelRef: (node: HTMLDivElement | null) => void;
  isLoading: boolean;
  hasMore: boolean;
}

export function useInfiniteScroll<T>({
  initialItems,
  initialPage,
  totalPages,
  fetchUrl,
  extractItems,
}: UseInfiniteScrollOptions<T>): UseInfiniteScrollResult<T> {
  const [items, setItems] = useState<T[]>(initialItems);
  const [page, setPage] = useState(initialPage);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(initialPage < totalPages);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadingRef = useRef(false);

  const fetchNextPage = useCallback(async () => {
    if (loadingRef.current || !hasMore) return;
    loadingRef.current = true;
    setIsLoading(true);

    const nextPage = page + 1;
    const separator = fetchUrl.includes("?") ? "&" : "?";
    const url = `${API_URL}${fetchUrl}${separator}page=${nextPage}`;

    try {
      const res = await fetch(url, {
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      const newItems = extractItems(data);

      setItems((prev) => [...prev, ...newItems]);
      setPage(nextPage);

      const responseTotalPages = data.pages ?? totalPages;
      setHasMore(nextPage < responseTotalPages);
    } catch {
      // silently fail, user can scroll again
    } finally {
      setIsLoading(false);
      loadingRef.current = false;
    }
  }, [page, hasMore, fetchUrl, extractItems, totalPages]);

  const sentinelRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (observerRef.current) observerRef.current.disconnect();
      if (!node) return;

      observerRef.current = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting) {
            fetchNextPage();
          }
        },
        { rootMargin: "400px" },
      );
      observerRef.current.observe(node);
    },
    [fetchNextPage],
  );

  useEffect(() => {
    return () => {
      if (observerRef.current) observerRef.current.disconnect();
    };
  }, []);

  return { items, sentinelRef, isLoading, hasMore };
}
