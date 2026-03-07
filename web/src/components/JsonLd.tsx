import type { Video, Account } from "@/types";
import { SITE_NAME, SITE_URL } from "@/lib/constants";

interface VideoJsonLdProps {
  video: Video;
}

export function VideoJsonLd({ video }: VideoJsonLdProps) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: video.title,
    description: video.title,
    thumbnailUrl: video.thumbnail_url,
    contentUrl: video.preview_url,
    uploadDate: video.published_at || new Date().toISOString(),
    duration: `PT${video.duration_sec}S`,
    interactionStatistic: {
      "@type": "InteractionCounter",
      interactionType: { "@type": "WatchAction" },
      userInteractionCount: video.view_count,
    },
    author: {
      "@type": "Person",
      name: video.account.username,
      url: video.original_url,
    },
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      url: SITE_URL,
    },
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}

interface BreadcrumbJsonLdProps {
  items: { name: string; url: string }[];
}

export function BreadcrumbJsonLd({ items }: BreadcrumbJsonLdProps) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: `${SITE_URL}${item.url}`,
    })),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}

interface WebsiteJsonLdProps {
  searchUrl?: string;
}

export function WebsiteJsonLd({ searchUrl }: WebsiteJsonLdProps) {
  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: SITE_URL,
  };

  if (searchUrl) {
    jsonLd.potentialAction = {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${SITE_URL}${searchUrl}?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    };
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}

interface ProfileJsonLdProps {
  account: Account;
}

export function ProfileJsonLd({ account }: ProfileJsonLdProps) {
  const sameAs: string[] = [];
  const links = account.social_links || {};

  if (links.instagram) {
    sameAs.push(
      links.instagram.startsWith("http")
        ? links.instagram
        : `https://instagram.com/${links.instagram}`,
    );
  }
  if (links.twitter) {
    sameAs.push(
      links.twitter.startsWith("http")
        ? links.twitter
        : `https://x.com/${links.twitter}`,
    );
  }
  if (links.onlyfans) {
    sameAs.push(
      links.onlyfans.startsWith("http")
        ? links.onlyfans
        : `https://onlyfans.com/${links.onlyfans}`,
    );
  }
  if (links.fansly) {
    sameAs.push(
      links.fansly.startsWith("http")
        ? links.fansly
        : `https://fansly.com/${links.fansly}`,
    );
  }

  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: account.display_name || account.username,
    url: `${SITE_URL}/model/${account.slug || account.username}`,
  };

  if (account.avatar_url) {
    jsonLd.image = account.avatar_url;
  }
  if (account.bio) {
    jsonLd.description = account.bio;
  }
  if (sameAs.length > 0) {
    jsonLd.sameAs = sameAs;
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}
