// web/src/lib/site-config.ts
import { cache } from "react";
import { headers } from "next/headers";

export interface SiteConfigResponse {
  domain: string;
  name: string;
  config: {
    template?: string;
    show_social_buttons?: boolean;
    [key: string]: unknown;
  };
}

// cache() ensures exactly one call per request regardless of how many
// Server Components invoke getSiteConfig() in the same render pass.
export const getSiteConfig = cache(async (): Promise<SiteConfigResponse | null> => {
  const hdrs = await headers();
  const domain = hdrs.get("host") || "localhost";

  try {
    const res = await fetch(
      // ?domain= is NOT used by the Go API for routing (uses X-Forwarded-Host).
      // It is appended solely to make the Next.js fetch cache key unique per domain,
      // preventing one site's config from being served to another.
      `${process.env.NEXT_PUBLIC_API_URL}/api/v1/config?domain=${domain}`,
      {
        next: {
          revalidate: 300,
          tags: [`site-config-${domain}`],
        },
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.data ?? null;
  } catch {
    return null;
  }
});
