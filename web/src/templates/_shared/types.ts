import type { Account, Video, SortOption } from "@/types";

export interface TemplateTheme {
  cssVars: Record<string, string>;
  maxWidth: string;
}

export interface VideoCardProps {
  video: Video;
  priority?: boolean;
}

export interface ProfileGridProps {
  videos: Video[];
  accountId: number;
  sentinelRef?: (node: HTMLDivElement | null) => void;
  isLoading?: boolean;
  hasMore?: boolean;
}

export interface ProfileHeaderProps {
  account: Account;
}

export interface SimilarModelsProps {
  videos: Video[];
}

export interface SortControlsProps {
  currentSort: SortOption;
}

/**
 * SiteTemplate defines the full UI kit for a site design.
 * Each template lives in its own directory under web/src/templates/<name>/.
 * Add a new template: create the directory, implement all components,
 * export a `template` object of this type, and register it in registry.ts.
 *
 * NOTE: Only client-compatible components belong here (this object is passed
 * through React Context). Server Components that fetch data (like ProfileStories)
 * should be imported directly by template pages, not placed in this interface.
 */
export interface SiteTemplate {
  name: string;
  theme: TemplateTheme;
  // Layout chrome
  Header: React.ComponentType;
  BottomNav: React.ComponentType;
  Footer: React.ComponentType;
  // Content
  VideoCard: React.ComponentType<VideoCardProps>;
  ProfileGrid: React.ComponentType<ProfileGridProps>;
  ProfileHeader: React.ComponentType<ProfileHeaderProps>;
  SimilarModels: React.ComponentType<SimilarModelsProps>;
  // Optional overridable client components
  SortControls?: React.ComponentType<SortControlsProps>;
}
