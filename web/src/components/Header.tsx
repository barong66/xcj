"use client";

import Link from "next/link";
import Image from "next/image";
import { SITE_NAME } from "@/lib/constants";
import { useOnlyFans } from "@/contexts/OnlyFansContext";
import { trackSocialClick } from "@/lib/analytics";

export function Header() {
  const { url, username, displayName, avatarUrl } = useOnlyFans();

  const handleOfClick = () => {
    if (!url) return;
    trackSocialClick(0, url, "onlyfans");
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <header className="sticky top-0 z-50 bg-bg/95 backdrop-blur-md">
      {/* Main header row */}
      <div className="max-w-[430px] mx-auto flex items-center justify-between h-11 px-4">
        <Link href="/" className="flex items-center">
          <span className="text-[22px] font-bold text-txt italic tracking-tight">
            {SITE_NAME}
          </span>
        </Link>

        {url && (
          <button
            onClick={handleOfClick}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#00AFF0] text-white text-xs font-semibold hover:opacity-90 transition-opacity shrink-0"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 18.6a6.6 6.6 0 110-13.2 6.6 6.6 0 010 13.2zm0-10.2a3.6 3.6 0 100 7.2 3.6 3.6 0 000-7.2z" />
            </svg>
            Follow me
          </button>
        )}
      </div>

      {/* Profile sub-bar: avatar + model name */}
      {displayName && (
        <div className="border-t border-border">
          <div className="max-w-[430px] mx-auto flex items-center gap-2 h-9 px-4">
            <div className="w-6 h-6 rounded-full overflow-hidden bg-bg-elevated shrink-0">
              {avatarUrl ? (
                <Image
                  src={avatarUrl}
                  alt={displayName}
                  width={24}
                  height={24}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-txt-muted text-[10px] font-bold">
                  {displayName.charAt(0).toUpperCase()}
                </div>
              )}
            </div>
            <span className="text-[13px] font-semibold text-txt truncate">
              {displayName}
            </span>
          </div>
        </div>
      )}

      <div className="border-b border-border" />
    </header>
  );
}
