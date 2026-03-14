// web/src/app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";
import { SiteLayout } from "@/components/SiteLayout";
import { TemplateProvider } from "@/templates/_shared/TemplateContext";
import { getTemplate } from "@/templates/_shared/registry";
import { getSiteConfig } from "@/lib/site-config";
import { SITE_URL } from "@/lib/constants";

export async function generateMetadata(): Promise<Metadata> {
  const siteConfig = await getSiteConfig();
  const siteName = siteConfig?.name || "TemptGuide";

  return {
    title: {
      default: `${siteName} - Trending Videos from Twitter & Instagram`,
      template: `%s | ${siteName}`,
    },
    description:
      "Discover trending videos from Twitter and Instagram. Browse by category, country, or search for your favorite content.",
    metadataBase: new URL(SITE_URL),
    openGraph: {
      type: "website",
      siteName,
      title: `${siteName} - Trending Videos from Twitter & Instagram`,
      description:
        "Discover trending videos from Twitter and Instagram. Browse by category, country, or search for your favorite content.",
      url: SITE_URL,
    },
    twitter: {
      card: "summary_large_image",
      title: `${siteName} - Trending Videos`,
      description: "Discover trending videos from Twitter and Instagram.",
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-video-preview": -1,
        "max-image-preview": "large",
        "max-snippet": -1,
      },
    },
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const siteConfig = await getSiteConfig();
  const templateName = siteConfig?.config?.template || "default";
  const template = getTemplate(templateName);

  const cssVars = Object.entries(template.theme.cssVars)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");

  return (
    <html lang="en">
      <head>
        <style>{`:root{${cssVars}}`}</style>
      </head>
      <body className="min-h-screen flex flex-col bg-bg text-txt">
        <TemplateProvider name={templateName}>
          <SiteLayout>{children}</SiteLayout>
        </TemplateProvider>
      </body>
    </html>
  );
}
