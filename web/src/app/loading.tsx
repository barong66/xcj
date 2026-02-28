export default function Loading() {
  return (
    <div className="animate-pulse">
      {/* Title skeleton */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="h-8 w-48 bg-bg-card rounded-card" />
          <div className="h-4 w-72 bg-bg-card rounded mt-2" />
        </div>
        <div className="h-9 w-52 bg-bg-card rounded-card" />
      </div>

      {/* Grid skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-5">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i}>
            <div className="aspect-video bg-bg-card rounded-card" />
            <div className="flex gap-3 mt-3">
              <div className="w-9 h-9 rounded-full bg-bg-card shrink-0" />
              <div className="flex-1">
                <div className="h-4 bg-bg-card rounded w-full mb-2" />
                <div className="h-3 bg-bg-card rounded w-3/4" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
