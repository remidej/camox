import { Button } from "@camox/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@camox/ui/dropdown-menu";
import { useQuery } from "@tanstack/react-query";
import { useSelector } from "@xstate/store-react";

import { useNavigate } from "@/features/navigation/navigation";
import { useProjectSlug } from "@/lib/auth";
import { pageQueries, projectQueries, type Page } from "@/lib/queries";

import { previewStore, selectPreviewSource } from "../../preview/previewStore";

type SiteStatus = "live" | "pending";
type PreviewSource = ReturnType<typeof selectPreviewSource>;

const statusStyles: Record<SiteStatus, { className: string; label: string }> = {
  live: {
    className:
      "border-green-500/30 bg-green-500/10 text-green-700 hover:bg-green-500/10 hover:text-green-700 dark:border-green-400/30 dark:bg-green-500/20 dark:text-green-400 dark:hover:bg-green-500/20 dark:hover:text-green-400",
    label: "Everything live",
  },
  pending: {
    className:
      "border-blue-500/30 bg-blue-500/10 text-blue-700 hover:bg-blue-500/10 hover:text-blue-700 dark:border-blue-400/30 dark:bg-blue-500/20 dark:text-blue-400 dark:hover:bg-blue-500/20 dark:hover:text-blue-400",
    label: "Pending changes",
  },
};

export function getSiteStatus(pages: readonly Pick<Page, "status">[]): SiteStatus {
  if (pages.length > 0 && pages.every((page) => page.status === "published")) return "live";
  return "pending";
}

export function canViewLiveSite(
  pages: readonly Pick<Page, "livePublishedCheckpointId">[],
  previewSource: PreviewSource,
): boolean {
  return previewSource === "draft" && pages.some((page) => page.livePublishedCheckpointId != null);
}

export function SiteStatusIndicator({ isPreview }: { isPreview: boolean }) {
  const projectSlug = useProjectSlug();
  const navigate = useNavigate();
  const previewSource = useSelector(previewStore, selectPreviewSource);
  const { data: project } = useQuery(projectQueries.getBySlug(projectSlug));
  const { data: pages = [] } = useQuery({
    ...pageQueries.list(project?.id ?? 0),
    enabled: !!project,
  });
  const status = getSiteStatus(pages);
  const { className, label } = statusStyles[status];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button type="button" variant="outline" className={className} />}
      >
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          disabled={!canViewLiveSite(pages, previewSource)}
          onClick={() => {
            previewStore.send({ type: "viewLiveSite" });
            if (isPreview) return;
            void navigate({ to: "/" });
          }}
        >
          View live site
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
