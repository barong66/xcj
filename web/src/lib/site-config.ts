// web/src/lib/site-config.ts
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

export async function getSiteConfig(): Promise<SiteConfigResponse | null> {
  const hdrs = await headers();
  const domain = hdrs.get("host") || "localhost";

  try {
    const res = await fetch(
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
}
