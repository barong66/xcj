import type { Metadata } from "next";
import "./globals.css";
import { SiteLayout } from "@/components/SiteLayout";
import { SITE_NAME, SITE_URL } from "@/lib/constants";

export const metadata: Metadata = {
  title: {
    default: `${SITE_NAME} - Trending Videos from Twitter & Instagram`,
    template: `%s | ${SITE_NAME}`,
  },
  description:
    "Discover trending videos from Twitter and Instagram. Browse by category, country, or search for your favorite content.",
  metadataBase: new URL(SITE_URL),
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: `${SITE_NAME} - Trending Videos from Twitter & Instagram`,
    description:
      "Discover trending videos from Twitter and Instagram. Browse by category, country, or search for your favorite content.",
    url: SITE_URL,
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} - Trending Videos`,
    description:
      "Discover trending videos from Twitter and Instagram.",
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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col bg-bg text-txt">
        <SiteLayout>{children}</SiteLayout>
      </body>
    </html>
  );
}
