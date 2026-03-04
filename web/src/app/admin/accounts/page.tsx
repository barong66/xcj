"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  getAdminAccounts,
  createAdminAccount,
  updateAdminAccount,
  deleteAdminAccount,
  reparseAccount,
  reparseAllAccounts,
} from "@/lib/admin-api";
import type { AdminAccount, AdminAccountList } from "@/lib/admin-api";
import { ToastProvider, useToast } from "../Toast";

function AccountsContent() {
  const router = useRouter();
  const [data, setData] = useState<AdminAccountList | null>(null);
  const [loading, setLoading] = useState(true);
  const [platform, setPlatform] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [showAddModal, setShowAddModal] = useState(false);
  const { toast } = useToast();

  const loadAccounts = useCallback(async () => {
    try {
      setLoading(true);
      const result = await getAdminAccounts({
        platform: platform || undefined,
        status: status || undefined,
        page,
        per_page: 20,
      });
      setData(result);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to load accounts", "error");
    } finally {
      setLoading(false);
    }
  }, [platform, status, page, toast]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  const handleToggleActive = async (account: AdminAccount) => {
    try {
      await updateAdminAccount(account.id, { is_active: !account.is_active });
      toast(`Account @${account.username} ${account.is_active ? "deactivated" : "activated"}`);
      loadAccounts();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update account", "error");
    }
  };

  const handleDelete = async (account: AdminAccount) => {
    if (!confirm(`Deactivate @${account.username}?`)) return;
    try {
      await deleteAdminAccount(account.id);
      toast(`Account @${account.username} deactivated`);
      loadAccounts();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to delete account", "error");
    }
  };

  const handleReparse = async (account: AdminAccount) => {
    try {
      await reparseAccount(account.id);
      toast(`Enqueued reparse for @${account.username}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to reparse", "error");
    }
  };

  const handleReparseAll = async () => {
    try {
      const result = await reparseAllAccounts();
      toast(`Enqueued ${result.enqueued} accounts for reparsing`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to reparse all", "error");
    }
  };

  const handleAccountCreated = () => {
    setShowAddModal(false);
    loadAccounts();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-white">Accounts</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={handleReparseAll}
            className="px-3 py-2 text-sm rounded-lg bg-[#1e1e1e] text-[#a0a0a0] hover:text-white hover:bg-[#252525] transition-colors"
          >
            Reparse All
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-3 py-2 text-sm rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors"
          >
            Add Account
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <select
          value={platform}
          onChange={(e) => { setPlatform(e.target.value); setPage(1); }}
          className="px-3 py-2 text-sm rounded-lg bg-[#141414] border border-[#2a2a2a] text-white focus:outline-none focus:border-accent"
        >
          <option value="">All Platforms</option>
          <option value="twitter">Twitter</option>
          <option value="instagram">Instagram</option>
        </select>
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="px-3 py-2 text-sm rounded-lg bg-[#141414] border border-[#2a2a2a] text-white focus:outline-none focus:border-accent"
        >
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        {data && (
          <span className="text-sm text-[#6b6b6b] ml-auto">
            {data.total.toLocaleString()} accounts
          </span>
        )}
      </div>

      {/* Table */}
      <div className="bg-[#141414] rounded-lg border border-[#1e1e1e] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#1e1e1e]">
                <th className="text-left px-4 py-3 text-[#6b6b6b] font-medium">Username</th>
                <th className="text-left px-4 py-3 text-[#6b6b6b] font-medium">Platform</th>
                <th className="text-right px-4 py-3 text-[#6b6b6b] font-medium">Videos</th>
                <th className="text-left px-4 py-3 text-[#6b6b6b] font-medium">Last Parsed</th>
                <th className="text-right px-4 py-3 text-[#6b6b6b] font-medium">Errors</th>
                <th className="text-center px-4 py-3 text-[#6b6b6b] font-medium">Status</th>
                <th className="text-right px-4 py-3 text-[#6b6b6b] font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-[#6b6b6b]">
                    Loading...
                  </td>
                </tr>
              ) : data && data.accounts.length > 0 ? (
                data.accounts.map((account) => (
                  <AccountRow
                    key={account.id}
                    account={account}
                    onOpen={() => router.push(`/admin/accounts/${account.id}`)}
                    onToggleActive={() => handleToggleActive(account)}
                    onDelete={() => handleDelete(account)}
                    onReparse={() => handleReparse(account)}
                  />
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-[#6b6b6b]">
                    No accounts found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data && data.total_pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-[#1e1e1e]">
            <span className="text-sm text-[#6b6b6b]">
              Page {data.page} of {data.total_pages}
            </span>
            <div className="flex gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                className="px-3 py-1.5 text-sm rounded bg-[#1e1e1e] text-[#a0a0a0] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <button
                disabled={page >= data.total_pages}
                onClick={() => setPage(page + 1)}
                className="px-3 py-1.5 text-sm rounded bg-[#1e1e1e] text-[#a0a0a0] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Add Account Modal */}
      {showAddModal && (
        <AddAccountModal
          onClose={() => setShowAddModal(false)}
          onCreated={handleAccountCreated}
        />
      )}
    </div>
  );
}

function AccountRow({
  account,
  onOpen,
  onToggleActive,
  onDelete,
  onReparse,
}: {
  account: AdminAccount;
  onOpen: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
  onReparse: () => void;
}) {
  const linkCount = account.social_links ? Object.keys(account.social_links).length : 0;
  return (
    <tr className="border-b border-[#1e1e1e] hover:bg-[#1a1a1a] transition-colors">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {account.avatar_url ? (
            <img
              src={account.avatar_url}
              alt=""
              className="w-7 h-7 rounded-full"
            />
          ) : (
            <div className="w-7 h-7 rounded-full bg-[#2a2a2a] flex items-center justify-center text-xs text-[#6b6b6b]">
              {account.username.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <button onClick={onOpen} className="text-white font-medium hover:text-accent transition-colors">
              @{account.username}
            </button>
            {account.display_name && (
              <span className="text-[#6b6b6b] ml-1.5">{account.display_name}</span>
            )}
          </div>
          {account.is_paid && (
            <span className="px-1.5 py-0.5 text-[10px] rounded bg-yellow-500/20 text-yellow-400 font-medium">
              PAID
            </span>
          )}
          {linkCount > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] rounded bg-accent/15 text-accent font-medium">
              {linkCount} {linkCount === 1 ? "link" : "links"}
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-3">
        <PlatformBadge platform={account.platform} />
      </td>
      <td className="px-4 py-3 text-right text-white tabular-nums">
        {account.video_count.toLocaleString()}
      </td>
      <td className="px-4 py-3 text-[#a0a0a0]">
        {account.last_parsed_at
          ? new Date(account.last_parsed_at).toLocaleDateString()
          : "-"}
      </td>
      <td className="px-4 py-3 text-right">
        {account.parse_errors > 0 ? (
          <span className="text-red-400">{account.parse_errors}</span>
        ) : (
          <span className="text-[#6b6b6b]">0</span>
        )}
      </td>
      <td className="px-4 py-3 text-center">
        <span
          className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
            account.is_active
              ? "bg-green-500/10 text-green-400"
              : "bg-red-500/10 text-red-400"
          }`}
        >
          {account.is_active ? "Active" : "Inactive"}
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={onReparse}
            title="Reparse"
            className="p-1.5 rounded hover:bg-[#252525] text-[#a0a0a0] hover:text-accent transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>
          <button
            onClick={onToggleActive}
            title={account.is_active ? "Deactivate" : "Activate"}
            className="p-1.5 rounded hover:bg-[#252525] text-[#a0a0a0] hover:text-yellow-400 transition-colors"
          >
            {account.is_active ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
                <line x1="12" y1="2" x2="12" y2="12" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polygon points="10 8 16 12 10 16 10 8" />
              </svg>
            )}
          </button>
          <button
            onClick={onDelete}
            title="Delete"
            className="p-1.5 rounded hover:bg-[#252525] text-[#a0a0a0] hover:text-red-400 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        </div>
      </td>
    </tr>
  );
}

function PlatformBadge({ platform }: { platform: string }) {
  const colors: Record<string, string> = {
    twitter: "bg-blue-500/10 text-blue-400",
    instagram: "bg-pink-500/10 text-pink-400",
  };

  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-xs font-medium capitalize ${
        colors[platform] || "bg-[#2a2a2a] text-[#a0a0a0]"
      }`}
    >
      {platform}
    </span>
  );
}

function AddAccountModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [accountPlatform, setAccountPlatform] = useState("twitter");
  const [username, setUsername] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) return;

    setSubmitting(true);
    try {
      const account = await createAdminAccount({
        platform: accountPlatform,
        username: username.trim(),
      });
      toast(`Account @${account.username} created and enqueued for parsing`);
      onCreated();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to create account", "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-[#141414] border border-[#2a2a2a] rounded-lg w-full max-w-md">
        <div className="px-5 py-4 border-b border-[#1e1e1e] flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Add Account</h2>
          <button onClick={onClose} className="text-[#6b6b6b] hover:text-white transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-[#a0a0a0] mb-1.5">
              Platform
            </label>
            <select
              value={accountPlatform}
              onChange={(e) => setAccountPlatform(e.target.value)}
              className="w-full px-3 py-2.5 text-sm rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-white focus:outline-none focus:border-accent"
            >
              <option value="twitter">Twitter</option>
              <option value="instagram">Instagram</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-[#a0a0a0] mb-1.5">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="username (without @)"
              autoFocus
              className="w-full px-3 py-2.5 text-sm rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] text-white placeholder-[#6b6b6b] focus:outline-none focus:border-accent"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg bg-[#1e1e1e] text-[#a0a0a0] hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !username.trim()}
              className="px-4 py-2 text-sm rounded-lg bg-accent text-white hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? "Adding..." : "Add Account"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function AccountsPage() {
  return (
    <ToastProvider>
      <AccountsContent />
    </ToastProvider>
  );
}
