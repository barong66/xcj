"use client";

import Image from "next/image";
import Link from "next/link";
import type { Video } from "@/types";

interface SimilarModelsProps {
  videos: Video[];
}

export function SimilarModels({ videos }: SimilarModelsProps) {
  if (!videos || videos.length === 0) return null;

  // Deduplicate by account — show one video per unique account.
  const seen = new Set<number>();
  const unique: Video[] = [];
  for (const v of videos) {
    const accountId = v.account?.id;
    if (accountId && !seen.has(accountId)) {
      seen.add(accountId);
      unique.push(v);
    }
  }

  if (unique.length === 0) return null;

  return (
    <div className="border-t border-border mt-2">
      <p className="px-4 py-3 text-[13px] font-semibold text-txt">
        Similar models
      </p>
      <div className="grid grid-cols-3 gap-px bg-border">
        {unique.map((video) => {
          const account = video.account!;
          const slug = account.slug || account.username;

          return (
            <Link
              key={account.id}
              href={`/model/${slug}`}
              className="relative block aspect-[4/5] bg-bg-card"
            >
              <Image
                src={video.thumbnail_url}
                alt={account.display_name || account.username}
                fill
                sizes="143px"
                className="object-cover"
                loading="lazy"
              />
              {/* Overlay with avatar + name */}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pb-2 pt-6">
                <div className="flex items-center gap-1.5">
                  {account.avatar_url ? (
                    <div className="w-5 h-5 rounded-full overflow-hidden shrink-0 ring-1 ring-white/30">
                      <Image
                        src={account.avatar_url}
                        alt={account.username}
                        width={20}
                        height={20}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ) : (
                    <div className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                      <span className="text-[9px] font-bold text-white">
                        {account.username.charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}
                  <span className="text-[11px] font-medium text-white truncate">
                    {account.display_name || account.username}
                  </span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
