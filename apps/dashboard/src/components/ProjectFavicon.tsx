import { getFaviconUrl } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Shows a project's favicon as its website does: the uploaded one, or Camox's default when none
 * was uploaded. The URL includes `?v=${project.updatedAt}` so React Query invalidations naturally
 * bust the browser cache after upload or delete.
 */
export function ProjectFavicon({
  project,
  size = 24,
  className,
}: {
  project: { id: number; updatedAt: number };
  size?: number;
  className?: string;
}) {
  return (
    <img
      src={getFaviconUrl(project)}
      alt=""
      style={{ width: size, height: size }}
      className={cn("rounded-sm object-cover", className)}
    />
  );
}
