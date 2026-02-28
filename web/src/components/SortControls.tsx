"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import type { SortOption } from "@/types";

interface SortControlsProps {
  currentSort: SortOption;
}

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "recent", label: "Recent" },
  { value: "popular", label: "Popular" },
  { value: "random", label: "Random" },
];

export function SortControls({ currentSort }: SortControlsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleSort = useCallback(
    (sort: SortOption) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("sort", sort);
      params.delete("page");
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams]
  );

  return (
    <div className="flex items-center border-b border-border">
      {SORT_OPTIONS.map((option) => (
        <button
          key={option.value}
          onClick={() => handleSort(option.value)}
          className={`flex-1 py-2.5 text-[13px] font-semibold text-center transition-colors relative ${
            currentSort === option.value
              ? "text-txt"
              : "text-txt-muted"
          }`}
        >
          {option.label}
          {currentSort === option.value && (
            <span className="absolute bottom-0 left-0 right-0 h-[1px] bg-txt" />
          )}
        </button>
      ))}
    </div>
  );
}
