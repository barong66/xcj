"use client";

import { useCallback } from "react";
import { trackClick } from "@/lib/analytics";

interface VideoClickButtonProps {
  videoId: string;
  originalUrl: string;
}

export function VideoClickButton({ videoId, originalUrl }: VideoClickButtonProps) {
  const handleClick = useCallback(() => {
    trackClick(videoId);
    window.open(originalUrl, "_blank", "noopener,noreferrer");
  }, [videoId, originalUrl]);

  return (
    <button
      onClick={handleClick}
      className="absolute inset-0 flex items-center justify-center bg-black/20 hover:bg-black/40 transition-colors group cursor-pointer"
      aria-label="Watch on original platform"
    >
      <div className="w-16 h-16 rounded-full bg-white/90 flex items-center justify-center group-hover:bg-white group-hover:scale-110 transition-transform">
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="#0f0f0f"
        >
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
      </div>
    </button>
  );
}
