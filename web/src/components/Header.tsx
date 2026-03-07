"use client";

import Link from "next/link";
import { SITE_NAME } from "@/lib/constants";
import { useOnlyFans } from "@/contexts/OnlyFansContext";
import { trackSocialClick } from "@/lib/analytics";

export function Header() {
  const { url, username } = useOnlyFans();

  const handleOfClick = () => {
    if (!url) return;
    trackSocialClick(0, url, "onlyfans");
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <header className="sticky top-0 z-50 bg-bg/95 backdrop-blur-md border-b border-border">
      <div className="max-w-[430px] mx-auto flex items-center justify-between h-11 px-4">
        <Link href="/" className="flex items-center">
          <span className="text-[22px] font-bold text-txt italic tracking-tight">
            {SITE_NAME}
          </span>
        </Link>

        {url && (
          <button
            onClick={handleOfClick}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#00AFF0] text-white text-xs font-semibold hover:opacity-90 transition-opacity"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 18.6a6.6 6.6 0 110-13.2 6.6 6.6 0 010 13.2zm0-10.2a3.6 3.6 0 100 7.2 3.6 3.6 0 000-7.2z" />
            </svg>
            Follow me
          </button>
        )}
      </div>
    </header>
  );
}
