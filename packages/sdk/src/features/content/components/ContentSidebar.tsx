import { ImageIcon, ListIcon, type LucideIcon } from "lucide-react";

import { Link } from "@/features/navigation/navigation";
import { collectionContentPath, STUDIO_CONTENT_PATH } from "@/features/studio/routes";
import type { CollectionDefinition } from "@/lib/queries";
import { cn } from "@/lib/utils";

import { ContentSidebarGroup } from "./ContentSidebarGroup";

export const ContentSidebar = ({
  collections,
  selectedCollectionId,
  collectionsError,
}: {
  collections: CollectionDefinition[];
  selectedCollectionId: string | null;
  collectionsError: boolean;
}) => {
  return (
    <nav
      aria-label="Content"
      className="flex w-[220px] shrink-0 flex-col gap-4 overflow-y-auto border-r-2 p-2"
    >
      <ContentSidebarGroup title="Camox">
        <ContentSidebarItem
          icon={ImageIcon}
          title="Assets"
          selected={selectedCollectionId === null}
          to={STUDIO_CONTENT_PATH}
        />
      </ContentSidebarGroup>
      {collections.length > 0 && (
        <ContentSidebarGroup title="Collections">
          {collections.map((collection) => (
            <ContentSidebarItem
              key={collection.collectionId}
              icon={ListIcon}
              title={collection.title}
              selected={selectedCollectionId === collection.collectionId}
              to={collectionContentPath(collection.collectionId)}
            />
          ))}
        </ContentSidebarGroup>
      )}
      {collectionsError && (
        <p role="alert" className="text-muted-foreground px-2 text-sm">
          Could not load collections.
        </p>
      )}
    </nav>
  );
};

const ContentSidebarItem = ({
  icon: Icon,
  title,
  selected,
  to,
}: {
  icon: LucideIcon;
  title: string;
  selected: boolean;
  to: string;
}) => (
  <Link
    to={to}
    aria-current={selected ? "page" : undefined}
    className={cn(
      "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-medium",
      selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
    )}
  >
    <Icon aria-hidden className="h-4 w-4 shrink-0" />
    <span className="truncate" title={title}>
      {title}
    </span>
  </Link>
);
