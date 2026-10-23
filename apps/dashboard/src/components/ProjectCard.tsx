import { GlobeIcon } from "lucide-react";
import { type MouseEvent, useState } from "react";

import { ProjectFavicon } from "@/components/ProjectFavicon";
import { siteUrl } from "@/components/ProjectSetup";
import type { ListedProject } from "@/lib/api";
import { useOpenWebsite } from "@/lib/open-website";
import { cn } from "@/lib/utils";

/** A plain left click, which opens the website signed in rather than following the link. */
function isPlainClick(event: MouseEvent) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/**
 * A project in the dashboard's project list: its Live homepage's OG image, its favicon and name,
 * and its URL, laid out like the studio's social preview. A Live project's card links to its
 * website: a plain click opens it in a new tab with the studio signed in, and modified clicks and
 * "copy link" use the website URL.
 */
export function ProjectCard({ project }: { project: ListedProject }) {
  const { open } = useOpenWebsite();
  const url = siteUrl(project);
  const live = project.status === "live";

  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    void open(project);
  };

  return (
    <div
      className={cn(
        "bg-card relative overflow-hidden rounded-lg border transition-colors",
        live && "hover:bg-accent/75 has-focus-visible:ring-ring/50 has-focus-visible:ring-3",
      )}
    >
      <ProjectImage project={project} />
      <div className="space-y-1.5 border-t px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <ProjectFavicon project={project} size={20} className="shrink-0" />
          <h2 className="min-w-0 flex-1 truncate font-medium">
            {live ? (
              // Stretched over the whole card, so the card is the link. Controls added to the card
              // sit above it with `relative`.
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={onClick}
                className="outline-none after:absolute after:inset-0"
              >
                {project.name}
              </a>
            ) : (
              project.name
            )}
          </h2>
        </div>
        <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
          <GlobeIcon className="size-3.5 shrink-0" />
          <span className="truncate">{url.replace(/^https:\/\//, "")}</span>
        </p>
      </div>
    </div>
  );
}

/**
 * The Live homepage's OG image at 1200×630 proportions, or a neutral placeholder with the
 * project's favicon when it can't load.
 */
function ProjectImage({ project }: { project: ListedProject }) {
  const src = project.homepageOgImageUrl;
  // Tracking the failed URL shows the image again once the URL changes.
  const [erroredSrc, setErroredSrc] = useState<string | null>(null);

  return (
    <div
      className="bg-muted flex items-center justify-center"
      style={{ aspectRatio: "1200 / 630" }}
    >
      {erroredSrc === src ? (
        <ProjectFavicon project={project} size={48} />
      ) : (
        <img
          src={src}
          alt=""
          className="size-full object-cover"
          onError={() => setErroredSrc(src)}
        />
      )}
    </div>
  );
}
