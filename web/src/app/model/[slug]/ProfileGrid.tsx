"use client";

import type { Video } from "@/types";
import { useTemplate } from "@/templates/_shared/TemplateContext";

interface ProfileGridProps {
  videos: Video[];
  accountId: number;
  sentinelRef?: (node: HTMLDivElement | null) => void;
  isLoading?: boolean;
  hasMore?: boolean;
}

export function ProfileGrid(props: ProfileGridProps) {
  const { ProfileGrid: TemplateProfileGrid } = useTemplate();
  return <TemplateProfileGrid {...props} />;
}
