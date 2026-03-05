"use client";

import { useState } from "react";
import Link from "next/link";
import type { Category } from "@/types";

interface CategoryGridProps {
  categories: Category[];
}

const INITIAL_COUNT = 11; // 11 categories + 1 "More..." button = 12 cells (3 rows × 4)
const EXPANDED_COUNT = 32; // 31 categories + 1 button or all shown

export function CategoryGrid({ categories }: CategoryGridProps) {
  const [expanded, setExpanded] = useState(false);

  if (categories.length === 0) return null;

  const sorted = [...categories].sort(
    (a, b) => (b.video_count || 0) - (a.video_count || 0),
  );

  const showMore = sorted.length > INITIAL_COUNT;
  const visible = expanded
    ? sorted.slice(0, EXPANDED_COUNT)
    : sorted.slice(0, INITIAL_COUNT);

  return (
    <div className="px-4 pb-3">
      <div className="grid grid-cols-4 gap-1.5">
        {visible.map((cat) => (
          <Link
            key={cat.slug}
            href={`/category/${cat.slug}`}
            className="px-2 py-2 bg-bg-card border border-border rounded-lg text-center hover:bg-bg-hover transition-colors"
          >
            <span className="text-[11px] font-medium text-txt leading-tight line-clamp-1">
              {cat.name}
            </span>
          </Link>
        ))}
        {showMore && !expanded && (
          <button
            onClick={() => setExpanded(true)}
            className="px-2 py-2 bg-bg-card border border-border rounded-lg text-center hover:bg-bg-hover transition-colors"
          >
            <span className="text-[11px] font-medium text-accent leading-tight">
              More...
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
