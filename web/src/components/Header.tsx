import Link from "next/link";
import { SITE_NAME } from "@/lib/constants";

export function Header() {
  return (
    <header className="sticky top-0 z-50 bg-bg/95 backdrop-blur-md border-b border-border">
      <div className="max-w-[430px] mx-auto flex items-center justify-between h-11 px-4">
        <Link href="/" className="flex items-center">
          <span className="text-[22px] font-bold text-txt italic tracking-tight">
            {SITE_NAME}
          </span>
        </Link>
      </div>
    </header>
  );
}
