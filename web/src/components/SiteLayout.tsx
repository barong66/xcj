"use client";

import { usePathname } from "next/navigation";
import { Header } from "./Header";
import { BottomNav } from "./BottomNav";
import { OnlyFansProvider } from "@/contexts/OnlyFansContext";

export function SiteLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAdmin = pathname.startsWith("/admin");

  if (isAdmin) {
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
