"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";

interface LoadMoreButtonProps {
  currentPage: number;
  totalPages: number;
}

export function LoadMoreButton({ currentPage, totalPages }: LoadMoreButtonProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const handleLoadMore = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(currentPage + 1));
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }, [router, pathname, searchParams, currentPage]);

  if (currentPage >= totalPages) return null;

  return (
    <div className="flex justify-center py-6 px-4">
      <button
        onClick={handleLoadMore}
        disabled={isPending}
        className="w-full py-3 bg-bg-card border border-border text-txt-secondary text-[13px] font-semibold rounded-xl hover:bg-bg-hover hover:text-txt transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isPending ? (
          <span className="flex items-center gap-2">
            <svg
              className="animate-spin w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            Loading...
          </span>
        ) : (
          `Load More (${currentPage} of ${totalPages})`
        )}
      </button>
    </div>
  );
}
