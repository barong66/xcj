"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { ChatScreen } from "./ChatScreen";
import type { Account } from "@/types";

interface ChatButtonProps {
  account: Account;
}

export function ChatButton({ account }: ChatButtonProps) {
  const [open, setOpen] = useState(false);

  if (!account.chat_enabled) return null;

  const slug = account.slug || account.username;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full bg-accent text-white hover:bg-accent/90 transition-colors shrink-0"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" />
        </svg>
        Chat
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <ChatScreen
          slug={slug}
          accountId={account.id}
          modelName={account.display_name || account.username}
          avatarUrl={account.avatar_url}
          onClose={() => setOpen(false)}
        />,
        document.body
      )}
    </>
  );
}
