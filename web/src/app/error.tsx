"use client";

import Link from "next/link";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] text-center">
      <svg
        className="w-16 h-16 text-txt-muted mb-4"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
        />
      </svg>
      <h2 className="text-xl font-medium text-txt mb-2">Something went wrong</h2>
      <p className="text-txt-secondary mb-6 max-w-md">
        An unexpected error occurred. Please try again.
      </p>
      <div className="flex items-center gap-3">
        <button
          onClick={reset}
          className="px-6 py-2.5 text-sm font-medium bg-bg-card border border-border text-txt-secondary rounded-card hover:bg-bg-hover hover:text-txt transition-colors"
        >
          Try Again
        </button>
        <Link
          href="/"
          className="px-6 py-2.5 text-sm font-medium bg-accent text-white rounded-card hover:bg-accent-hover transition-colors"
        >
          Go Home
        </Link>
      </div>
    </div>
  );
}
