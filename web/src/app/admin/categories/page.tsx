"use client";

import { useEffect, useState } from "react";
import { getAdminCategories } from "@/lib/admin-api";
import type { AdminCategory } from "@/lib/admin-api";

export default function CategoriesPage() {
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const data = await getAdminCategories();
        setCategories(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load categories");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const totalVideos = categories.reduce((sum, c) => sum + c.video_count, 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-white">Categories</h1>
        <span className="text-sm text-[#6b6b6b]">
          {categories.length} categories, {totalVideos.toLocaleString()} total video assignments
        </span>
      </div>

      {error ? (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-red-400 text-sm">
          {error}
        </div>
      ) : (
        <div className="bg-[#141414] rounded-lg border border-[#1e1e1e] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#1e1e1e]">
                  <th className="text-left px-4 py-3 text-[#6b6b6b] font-medium">Name</th>
                  <th className="text-left px-4 py-3 text-[#6b6b6b] font-medium">Slug</th>
                  <th className="text-right px-4 py-3 text-[#6b6b6b] font-medium">Videos</th>
                  <th className="text-center px-4 py-3 text-[#6b6b6b] font-medium">Status</th>
                  <th className="text-right px-4 py-3 text-[#6b6b6b] font-medium">Sort Order</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-[#6b6b6b]">
                      Loading...
                    </td>
                  </tr>
                ) : categories.length > 0 ? (
                  categories.map((cat) => (
                    <tr
                      key={cat.id}
                      className="border-b border-[#1e1e1e] hover:bg-[#1a1a1a] transition-colors"
                    >
                      <td className="px-4 py-3 text-white font-medium">
                        {cat.name}
                      </td>
                      <td className="px-4 py-3 text-[#a0a0a0] font-mono text-xs">
                        {cat.slug}
                      </td>
                      <td className="px-4 py-3 text-right text-white tabular-nums">
                        {cat.video_count.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                            cat.is_active
                              ? "bg-green-500/10 text-green-400"
                              : "bg-red-500/10 text-red-400"
                          }`}
                        >
                          {cat.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-[#6b6b6b] tabular-nums">
                        {cat.sort_order}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-[#6b6b6b]">
                      No categories found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
