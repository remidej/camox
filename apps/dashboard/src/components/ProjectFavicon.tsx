import { useState } from "react";

import { getFaviconUrl } from "@/lib/api";
import { cn } from "@/lib/utils";

type ProjectInfo = {
  id: number;
  name: string;
  updatedAt: number;
};

/**
 * Shows a project's favicon, falling back to a tinted initial tile when no
 * favicon has been uploaded (or the request 404s). The favicon URL includes
 * `?v=${project.updatedAt}` so React Query invalidations naturally bust the
 * browser cache after upload or delete.
 */
export function ProjectFavicon({
  project,
  size = 24,
  className,
}: {
  project: ProjectInfo;
  size?: number;
  className?: string;
}) {
  const src = getFaviconUrl(project);
  // Tracking the failed URL resets the error when the URL changes (new upload after a 404).
  const [erroredSrc, setErroredSrc] = useState<string | null>(null);

  const sizeStyle = { width: size, height: size };

  if (erroredSrc === src) {
    return <FaviconFallback name={project.name} size={size} className={className} />;
  }

  return (
    <img
      src={src}
      alt=""
      style={sizeStyle}
      className={cn("rounded-sm object-cover", className)}
      onError={() => setErroredSrc(src)}
    />
  );
}

function FaviconFallback({
  name,
  size,
  className,
}: {
  name: string;
  size: number;
  className?: string;
}) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <div
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.5)) }}
      className={cn(
        "bg-muted text-muted-foreground flex shrink-0 items-center justify-center rounded-sm font-medium",
        className,
      )}
      aria-hidden
    >
      {initial}
    </div>
  );
}
