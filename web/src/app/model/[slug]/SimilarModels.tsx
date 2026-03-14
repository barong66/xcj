"use client";

import type { Video } from "@/types";
import { useTemplate } from "@/templates/_shared/TemplateContext";

interface SimilarModelsProps {
  videos: Video[];
}

export function SimilarModels(props: SimilarModelsProps) {
  const { SimilarModels: TemplateSimilarModels } = useTemplate();
  return <TemplateSimilarModels {...props} />;
}
