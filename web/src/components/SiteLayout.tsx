"use client";

import { usePathname } from "next/navigation";
import { OnlyFansProvider } from "@/contexts/OnlyFansContext";
import { TemplateProvider, useTemplate } from "@/templates/_shared/TemplateContext";

const templateName = process.env.NEXT_PUBLIC_TEMPLATE || "default";

function SiteContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { Header, BottomNav } = useTemplate();

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
    </OnlyFansProvider>
  );
}

export function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <TemplateProvider name={templateName}>
      <SiteContent>{children}</SiteContent>
    </TemplateProvider>
  );
}
