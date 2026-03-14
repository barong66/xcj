"use client";

import type { Video } from "@/types";
import { useTemplate } from "@/templates/_shared/TemplateContext";

interface VideoCardProps {
  video: Video;
  priority?: boolean;
}

export function VideoCard(props: VideoCardProps) {
  const { VideoCard: TemplateVideoCard } = useTemplate();
  return <TemplateVideoCard {...props} />;
}
