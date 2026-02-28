import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] text-center">
      <h1 className="text-6xl font-bold text-accent mb-4">404</h1>
      <h2 className="text-xl font-medium text-txt mb-2">Page Not Found</h2>
      <p className="text-txt-secondary mb-6 max-w-md">
        The page you are looking for does not exist or has been moved.
      </p>
      <Link
        href="/"
        className="px-6 py-2.5 text-sm font-medium bg-accent text-white rounded-card hover:bg-accent-hover transition-colors"
      >
        Back to Home
      </Link>
    </div>
  );
}
