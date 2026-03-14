// web/src/components/SiteLayout.tsx
"use client";

import { usePathname } from "next/navigation";
import { OnlyFansProvider } from "@/contexts/OnlyFansContext";
import { useTemplate } from "@/templates/_shared/TemplateContext";

function SiteContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { Header, BottomNav, Footer } = useTemplate();

  if (pathname.startsWith("/admin")) {
    return <>{children}</>;
  }

  return (
    <OnlyFansProvider>
      <Header />
      <main className="flex-1 w-full max-w-[430px] mx-auto pb-14">
        {children}
      </main>
      <BottomNav />
      <Footer />
    </OnlyFansProvider>
  );
}

export function SiteLayout({ children }: { children: React.ReactNode }) {
  return <SiteContent>{children}</SiteContent>;
}
