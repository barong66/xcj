"use client";

import { useState } from "react";
import Link from "next/link";
import { runFinder, bulkCreateAccounts } from "@/lib/admin-api";
import type {
  FinderAccount,
  FinderResult,
  BulkCreateAccountResult,
  BulkCreateResult,
} from "@/lib/admin-api";
import { ToastProvider, useToast } from "../Toast";

// ─── Tab types ───────────────────────────────────────────────────────────────

type TabId = "twitter" | "instagram";

const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
  {
    id: "twitter",
    label: "Twitter",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
  },
  {
    id: "instagram",
    label: "Instagram",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
        <circle cx="12" cy="12" r="5" />
        <circle cx="17.5" cy="6.5" r="1.5" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
];

// ─── Main page ───────────────────────────────────────────────────────────────

function VideoScraperContent() {
  const [activeTab, setActiveTab] = useState<TabId>("twitter");

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Video Scraper</h1>
          <p className="text-sm text-[#6b6b6b] mt-1">
            Find and import video accounts for scraping
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-5 border-b border-[#1e1e1e]">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors relative ${
              activeTab === tab.id
                ? "text-accent"
                : "text-[#6b6b6b] hover:text-[#a0a0a0]"
            }`}
          >
            {tab.icon}
            {tab.label}
            {activeTab === tab.id && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "twitter" && <TwitterTab />}
      {activeTab === "instagram" && <InstagramTab />}
    </div>
  );
}

// ─── Twitter Tab (existing Finder logic) ─────────────────────────────────────

function TwitterTab() {
  const [keyword, setKeyword] = useState("");
  const [count, setCount] = useState(5);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<FinderResult | null>(null);
  const { toast } = useToast();

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyword.trim() || loading) return;

    setLoading(true);
    setResult(null);
    try {
      const data = await runFinder({
        keyword: keyword.trim(),
        count,
        platform: "twitter",
      });
      setResult(data);

      const created = data.accounts.filter((a) => a.status === "created").length;
      const existing = data.accounts.filter((a) => a.status === "existing").length;
      const errors = data.accounts.filter((a) => a.status === "error").length;

      let msg = `Found ${data.accounts_found} accounts.`;
      if (created > 0) msg += ` ${created} new created.`;
      if (existing > 0) msg += ` ${existing} already existed.`;
      if (errors > 0) msg += ` ${errors} failed.`;

      toast(msg, errors > 0 ? "info" : "success");
    } catch (err) {
      toast(
        err instanceof Error ? err.message : "Search failed",
        "error"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      {/* Search Form */}
      <div className="bg-[#141414] rounded-lg border border-[#1e1e1e] p-5 mb-5">
        <form onSubmit={handleSearch} className="flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-sm font-medium text-[#a0a0a0] mb-1.5">
              Keyword
            </label>
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder='e.g. "flowers", "cooking", "cars"'
              autoFocus
              className="w-full px-3 py-2.5 text-sm rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-white placeholder-[#6b6b6b] focus:outline-none focus:border-accent"
            />
          </div>

          <div className="w-28">
            <label className="block text-sm font-medium text-[#a0a0a0] mb-1.5">
              Count
            </label>
            <input
              type="number"
              value={count}
              onChange={(e) =>
                setCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))
              }
              min={1}
              max={20}
              className="w-full px-3 py-2.5 text-sm rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-white focus:outline-none focus:border-accent"
            />
          </div>

          <button
            type="submit"
            disabled={loading || !keyword.trim()}
            className="px-5 py-2.5 text-sm rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 shrink-0"
          >
            {loading ? (
              <>
                <Spinner />
                Searching...
              </>
            ) : (
              <>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                Search
              </>
            )}
          </button>
        </form>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="bg-[#141414] rounded-lg border border-[#1e1e1e] p-12">
          <div className="flex flex-col items-center justify-center text-center">
            <Spinner className="h-8 w-8 text-accent mb-4" />
            <p className="text-white text-sm font-medium">
              Searching Twitter for &quot;{keyword}&quot;...
            </p>
            <p className="text-[#6b6b6b] text-xs mt-1">
              This may take up to 2 minutes
            </p>
          </div>
        </div>
      )}

      {/* Results */}
      {result && !loading && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <span className="text-sm text-[#a0a0a0]">
                Results for &quot;{result.keyword}&quot;
              </span>
              <span className="text-sm text-[#6b6b6b]">
                {result.accounts_found} accounts found
              </span>
            </div>
            <Link
              href="/admin/accounts"
              className="text-sm text-accent hover:text-accent-hover transition-colors"
            >
              View all accounts &rarr;
            </Link>
          </div>

          <div className="bg-[#141414] rounded-lg border border-[#1e1e1e] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#1e1e1e]">
                    <th className="text-left px-4 py-3 text-[#6b6b6b] font-medium">Account</th>
                    <th className="text-right px-4 py-3 text-[#6b6b6b] font-medium">Followers</th>
                    <th className="text-right px-4 py-3 text-[#6b6b6b] font-medium">Video Tweets</th>
                    <th className="text-right px-4 py-3 text-[#6b6b6b] font-medium">Engagement</th>
                    <th className="text-center px-4 py-3 text-[#6b6b6b] font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {result.accounts.length > 0 ? (
                    result.accounts.map((account, i) => (
                      <FinderRow key={i} account={account} />
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-[#6b6b6b]">
                        No accounts found for this keyword
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!result && !loading && (
        <div className="bg-[#141414] rounded-lg border border-[#1e1e1e] p-12">
          <div className="flex flex-col items-center justify-center text-center">
            <div className="w-12 h-12 rounded-full bg-[#1e1e1e] flex items-center justify-center mb-4">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#6b6b6b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>
            <p className="text-white text-sm font-medium">Find video accounts by topic</p>
            <p className="text-[#6b6b6b] text-xs mt-1 max-w-xs">
              Enter a keyword to search Twitter for accounts posting videos on
              that topic. Found accounts will be created and enqueued for parsing.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Instagram Tab ───────────────────────────────────────────────────────────

function parseUsernames(raw: string): string[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      // Remove URL prefix variants
      line = line
        .replace(/^https?:\/\/(www\.)?instagram\.com\//, "")
        .replace(/\/$/, "")
        .replace(/\?.*$/, "");
      // Remove @ prefix
      line = line.replace(/^@/, "");
      return line.trim();
    })
    .filter(Boolean)
    // Deduplicate (case-insensitive)
    .filter((v, i, arr) => arr.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i);
}

function InstagramTab() {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BulkCreateResult | null>(null);
  const { toast } = useToast();

  const usernames = parseUsernames(text);

  const handleApply = async () => {
    if (usernames.length === 0 || loading) return;

    setLoading(true);
    setResult(null);
    try {
      const data = await bulkCreateAccounts({
        platform: "instagram",
        usernames,
      });
      setResult(data);

      let msg = `${data.total} accounts processed.`;
      if (data.created > 0) msg += ` ${data.created} created.`;
      if (data.existing > 0) msg += ` ${data.existing} already existed.`;
      if (data.errors > 0) msg += ` ${data.errors} failed.`;

      toast(msg, data.errors > 0 ? "info" : "success");
    } catch (err) {
      toast(
        err instanceof Error ? err.message : "Import failed",
        "error"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      {/* Input Form */}
      <div className="bg-[#141414] rounded-lg border border-[#1e1e1e] p-5 mb-5">
        <label className="block text-sm font-medium text-[#a0a0a0] mb-2">
          Enter Instagram usernames (one per line)
        </label>
        <textarea
          value={text}
          onChange={(e) => { setText(e.target.value); setResult(null); }}
          placeholder={"username1\n@username2\nhttps://instagram.com/username3"}
          rows={8}
          className="w-full px-3 py-2.5 text-sm rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-white placeholder-[#6b6b6b] focus:outline-none focus:border-accent font-mono resize-y min-h-[160px]"
        />
        <div className="flex items-center justify-between mt-3">
          <span className="text-sm text-[#6b6b6b]">
            {usernames.length > 0 ? (
              <>
                <span className="text-white font-medium">{usernames.length}</span>{" "}
                {usernames.length === 1 ? "account" : "accounts"}
              </>
            ) : (
              "No accounts entered"
            )}
          </span>
          <button
            onClick={handleApply}
            disabled={loading || usernames.length === 0}
            className="px-5 py-2.5 text-sm rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {loading ? (
              <>
                <Spinner />
                Processing...
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Apply
              </>
            )}
          </button>
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="bg-[#141414] rounded-lg border border-[#1e1e1e] p-12">
          <div className="flex flex-col items-center justify-center text-center">
            <Spinner className="h-8 w-8 text-accent mb-4" />
            <p className="text-white text-sm font-medium">
              Creating {usernames.length} Instagram accounts...
            </p>
            <p className="text-[#6b6b6b] text-xs mt-1">
              Each account will be enqueued for scraping
            </p>
          </div>
        </div>
      )}

      {/* Results */}
      {result && !loading && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <span className="text-sm text-[#a0a0a0]">
                Results: {result.total} accounts processed
              </span>
              <div className="flex items-center gap-2 text-xs">
                {result.created > 0 && (
                  <span className="px-2 py-0.5 rounded bg-green-500/10 text-green-400">
                    {result.created} created
                  </span>
                )}
                {result.existing > 0 && (
                  <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-400">
                    {result.existing} existing
                  </span>
                )}
                {result.errors > 0 && (
                  <span className="px-2 py-0.5 rounded bg-red-500/10 text-red-400">
                    {result.errors} errors
                  </span>
                )}
              </div>
            </div>
            <Link
              href="/admin/accounts?platform=instagram"
              className="text-sm text-accent hover:text-accent-hover transition-colors"
            >
              View accounts &rarr;
            </Link>
          </div>

          <div className="bg-[#141414] rounded-lg border border-[#1e1e1e] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#1e1e1e]">
                    <th className="text-left px-4 py-3 text-[#6b6b6b] font-medium">Username</th>
                    <th className="text-center px-4 py-3 text-[#6b6b6b] font-medium">Status</th>
                    <th className="text-left px-4 py-3 text-[#6b6b6b] font-medium">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {result.accounts.map((account, i) => (
                    <BulkResultRow key={i} account={account} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!result && !loading && usernames.length === 0 && (
        <div className="bg-[#141414] rounded-lg border border-[#1e1e1e] p-12">
          <div className="flex flex-col items-center justify-center text-center">
            <div className="w-12 h-12 rounded-full bg-[#1e1e1e] flex items-center justify-center mb-4">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#6b6b6b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                <circle cx="12" cy="12" r="5" />
                <circle cx="17.5" cy="6.5" r="1.5" fill="#6b6b6b" stroke="none" />
              </svg>
            </div>
            <p className="text-white text-sm font-medium">Bulk import Instagram accounts</p>
            <p className="text-[#6b6b6b] text-xs mt-1 max-w-xs">
              Paste Instagram usernames or profile URLs above (one per line).
              They will be created and enqueued for video scraping.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Shared components ───────────────────────────────────────────────────────

function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function FinderRow({ account }: { account: FinderAccount }) {
  const statusColors: Record<string, string> = {
    created: "bg-green-500/10 text-green-400",
    existing: "bg-blue-500/10 text-blue-400",
    error: "bg-red-500/10 text-red-400",
  };

  const statusLabel: Record<string, string> = {
    created: "Created",
    existing: "Existing",
    error: "Error",
  };

  return (
    <tr className="border-b border-[#1e1e1e] hover:bg-[#1a1a1a] transition-colors">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {account.profile_image_url ? (
            <img src={account.profile_image_url} alt="" className="w-7 h-7 rounded-full" />
          ) : (
            <div className="w-7 h-7 rounded-full bg-[#2a2a2a] flex items-center justify-center text-xs text-[#6b6b6b]">
              {account.username.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <span className="text-white font-medium">@{account.username}</span>
            {account.display_name && (
              <span className="text-[#6b6b6b] ml-1.5">{account.display_name}</span>
            )}
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-right text-white tabular-nums">
        {formatNumber(account.follower_count)}
      </td>
      <td className="px-4 py-3 text-right text-white tabular-nums">
        {account.video_tweet_count}
      </td>
      <td className="px-4 py-3 text-right text-white tabular-nums">
        {formatNumber(account.total_engagement)}
      </td>
      <td className="px-4 py-3 text-center">
        <span
          className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
            statusColors[account.status] || "bg-[#2a2a2a] text-[#a0a0a0]"
          }`}
          title={account.error || undefined}
        >
          {statusLabel[account.status] || account.status}
        </span>
      </td>
    </tr>
  );
}

function BulkResultRow({ account }: { account: BulkCreateAccountResult }) {
  const statusColors: Record<string, string> = {
    created: "bg-green-500/10 text-green-400",
    existing: "bg-blue-500/10 text-blue-400",
    error: "bg-red-500/10 text-red-400",
  };

  const statusLabel: Record<string, string> = {
    created: "Created",
    existing: "Existing",
    error: "Error",
  };

  return (
    <tr className="border-b border-[#1e1e1e] hover:bg-[#1a1a1a] transition-colors">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-pink-500/10 flex items-center justify-center text-xs text-pink-400">
            {account.username.charAt(0).toUpperCase()}
          </div>
          <span className="text-white font-medium">@{account.username}</span>
        </div>
      </td>
      <td className="px-4 py-3 text-center">
        <span
          className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
            statusColors[account.status] || "bg-[#2a2a2a] text-[#a0a0a0]"
          }`}
        >
          {statusLabel[account.status] || account.status}
        </span>
      </td>
      <td className="px-4 py-3 text-[#6b6b6b] text-xs">
        {account.status === "created" && "Enqueued for scraping"}
        {account.status === "existing" && "Already in database"}
        {account.status === "error" && (account.error || "Unknown error")}
      </td>
    </tr>
  );
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

// ─── Page export ─────────────────────────────────────────────────────────────

export default function FinderPage() {
  return (
    <ToastProvider>
      <VideoScraperContent />
    </ToastProvider>
  );
}
