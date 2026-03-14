"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";

const navGroups = [
  {
    label: "OVERVIEW",
    items: [
      { label: "Dashboard", href: "/admin" },
    ],
  },
  {
    label: "ANALYTICS",
    items: [
      { label: "Traffic", href: "/admin/analytics/traffic" },
      { label: "Revenue", href: "/admin/analytics/revenue" },
    ],
  },
  {
    label: "CONTENT",
    items: [
      { label: "Accounts", href: "/admin/accounts" },
      { label: "Videos", href: "/admin/videos" },
      { label: "Queue", href: "/admin/queue" },
    ],
  },
  {
    label: "ADS",
    items: [
      { label: "Promo", href: "/admin/ads/promo" },
      { label: "Sources", href: "/admin/ads/sources" },
    ],
  },
  {
    label: "SITES",
    items: [
      { label: "Websites", href: "/admin/websites" },
      { label: "Categories", href: "/admin/categories" },
    ],
  },
  {
    label: "SYSTEM",
    items: [
      { label: "Health", href: "/admin/health" },
    ],
  },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Skip shell for login page
  if (pathname === "/admin/login") {
    return <>{children}</>;
  }

  return <AuthenticatedShell pathname={pathname} router={router} sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen}>{children}</AuthenticatedShell>;
}

function AuthenticatedShell({
  children,
  pathname,
  router,
  sidebarOpen,
  setSidebarOpen,
}: {
  children: React.ReactNode;
  pathname: string;
  router: ReturnType<typeof useRouter>;
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
}) {
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const cookies = document.cookie;
    if (cookies.includes("admin_authed=1")) {
      setAuthed(true);
    } else {
      router.push("/admin/login");
    }
    setChecking(false);
  }, [router]);

  if (checking) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-[#6b6b6b] text-sm">Loading...</div>
      </div>
    );
  }

  if (!authed) {
    return null;
  }

  const handleLogout = async () => {
    await fetch("/api/admin/auth", { method: "DELETE" });
    router.push("/admin/login");
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-56 bg-[#111111] border-r border-[#1e1e1e] flex flex-col transition-transform lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="h-14 flex items-center px-4 border-b border-[#1e1e1e] shrink-0">
          <Link href="/admin" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-accent flex items-center justify-center">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            </div>
            <span className="text-sm font-bold text-white">xcj</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/20 text-accent font-medium">
              ADMIN
            </span>
          </Link>
        </div>

        <nav className="flex-1 py-3 px-2 overflow-y-auto">
          {navGroups.map((group) => (
            <div key={group.label} className="mb-4">
              <div className="px-3 mb-1 text-[9px] font-semibold text-[#3a3a3a] uppercase tracking-widest">
                {group.label}
              </div>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const isActive =
                    item.href === "/admin"
                      ? pathname === "/admin"
                      : pathname.startsWith(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setSidebarOpen(false)}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                        isActive
                          ? "bg-accent/10 text-accent"
                          : "text-[#a0a0a0] hover:text-white hover:bg-[#1a1a1a]"
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="p-3 border-t border-[#1e1e1e]">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-[#a0a0a0] hover:text-white hover:bg-[#1a1a1a] transition-colors w-full"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Sign Out
          </button>
          <Link
            href="/"
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-[#a0a0a0] hover:text-white hover:bg-[#1a1a1a] transition-colors w-full mt-0.5"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            View Site
          </Link>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-14 bg-[#111111] border-b border-[#1e1e1e] flex items-center px-4 shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden mr-3 text-[#a0a0a0] hover:text-white"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <Breadcrumbs pathname={pathname} />
        </header>

        {/* Page content */}
        <main className="flex-1 p-4 sm:p-6 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

function Breadcrumbs({ pathname }: { pathname: string }) {
  const segments = pathname
    .replace("/admin", "")
    .split("/")
    .filter(Boolean);

  return (
    <div className="flex items-center gap-1.5 text-sm">
      <Link href="/admin" className="text-[#a0a0a0] hover:text-white transition-colors">
        Admin
      </Link>
      {segments.map((segment, i) => (
        <span key={i} className="flex items-center gap-1.5">
          <span className="text-[#3a3a3a]">/</span>
          <span className={i === segments.length - 1 ? "text-white capitalize" : "text-[#a0a0a0] capitalize"}>
            {segment}
          </span>
        </span>
      ))}
    </div>
  );
}
