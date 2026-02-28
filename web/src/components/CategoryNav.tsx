"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Category } from "@/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

export function CategoryNav() {
  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    fetch(`${API_URL}/api/v1/categories`, {
      headers: { "Content-Type": "application/json" },
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch categories");
        return res.json();
      })
      .then((data) => {
        const cats = Array.isArray(data) ? data : data.categories || [];
        setCategories(cats);
      })
      .catch(() => {
        // If API is unavailable, show nothing
        setCategories([]);
      });
  }, []);

  if (categories.length === 0) return null;

  return (
    <nav className="category-scroll flex items-center gap-2 py-2 overflow-x-auto">
      <Link
        href="/"
        className="shrink-0 px-3 py-1.5 text-sm rounded-full bg-bg-elevated text-txt-secondary hover:text-txt hover:bg-bg-hover transition-colors"
      >
        All
      </Link>
      {categories.map((cat) => (
        <Link
          key={cat.slug}
          href={`/category/${cat.slug}`}
          className="shrink-0 px-3 py-1.5 text-sm rounded-full bg-bg-elevated text-txt-secondary hover:text-txt hover:bg-bg-hover transition-colors"
        >
          {cat.name}
        </Link>
      ))}
    </nav>
  );
}
