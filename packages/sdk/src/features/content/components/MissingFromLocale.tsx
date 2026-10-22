import { Button } from "@camox/ui/button";
import { toast } from "@camox/ui/toaster";
import { useMutation } from "@tanstack/react-query";
import { Undo2Icon } from "lucide-react";

import { localeLabel } from "@/features/studio/localeOptions";
import { useProjectUuid } from "@/lib/auth";
import { type CollectionDefinition, localeMutations, type MissingFromLocale } from "@/lib/queries";
import { reads, useReadQuery, useStudioCache } from "@/lib/studio-reads";
import { useViewLocale } from "@/lib/view-locale-context";

import { ContentSidebarGroup } from "./ContentSidebarGroup";

type Missing = { entity: "page" | "record"; id: string; collectionId?: string; name: string };

/**
 * The pages and collection records deleted from the language viewed, which Camox no longer
 * translates into it, each with an action adding it back (GLOSSARY: Exclusion). Records show
 * under their collection, while collections show. The default language misses nothing.
 */
export const MissingFromLocaleGroup = ({
  collections,
}: {
  collections: readonly CollectionDefinition[];
}) => {
  const { locale } = useViewLocale();
  const projectUuid = useProjectUuid();
  const project = useReadQuery(reads.project({ projectUuid }), {
    enabled: !!projectUuid && !locale.isDefault,
  });
  const projectId = project.data?.id;
  const missing = useReadQuery(reads.missingFromLocale({ projectId: projectId ?? 0 }), {
    enabled: !!projectId && !locale.isDefault,
  });
  if (locale.isDefault || !projectId || !missing.data) return null;

  const groups = missingGroups(missing.data, collections);
  if (groups.length === 0) return null;
  const language = localeLabel(locale.tag);
  return (
    <ContentSidebarGroup title={`Missing from ${language}`}>
      {groups.map((group) => (
        <ul key={group.title} aria-label={group.title} className="flex flex-col">
          <li className="text-muted-foreground px-2 pt-1 text-xs">{group.title}</li>
          {group.entries.map((entry) => (
            <MissingEntry
              key={entry.id}
              projectId={projectId}
              projectUuid={projectUuid}
              language={language}
              entry={entry}
            />
          ))}
        </ul>
      ))}
    </ContentSidebarGroup>
  );
};

/** What's missing, pages first, then records under each collection shown, in its order. */
function missingGroups(missing: MissingFromLocale, collections: readonly CollectionDefinition[]) {
  const groups: { title: string; entries: (Missing & { detail?: string })[] }[] = [];
  if (missing.pages.length > 0) {
    groups.push({
      title: "Pages",
      entries: missing.pages.map((page) => ({
        entity: "page",
        id: page.id,
        name: page.nickname || page.fullPath,
        detail: page.fullPath,
      })),
    });
  }
  for (const collection of collections) {
    const records = missing.records.filter(
      (record) => record.collectionId === collection.collectionId,
    );
    if (records.length === 0) continue;
    groups.push({
      title: collection.title,
      entries: records.map((record) => ({
        entity: "record",
        id: record.id,
        collectionId: record.collectionId,
        name: record.title || "Untitled item",
      })),
    });
  }
  return groups;
}

const MissingEntry = ({
  projectId,
  projectUuid,
  language,
  entry,
}: {
  projectId: number;
  projectUuid: string;
  language: string;
  entry: Missing & { detail?: string };
}) => {
  const cache = useStudioCache();
  const addBack = useMutation({
    ...localeMutations.addBack(),
    onSuccess: () => {
      toast.success(`Added “${entry.name}” back to ${language}`, {
        description: "Camox is translating it.",
      });
      void cache.invalidate(reads.missingFromLocale({ projectId }));
      if (entry.collectionId) {
        void cache.invalidate(reads.records({ projectUuid, collectionId: entry.collectionId }));
      } else {
        void cache.invalidate(reads.pageList({ projectUuid }));
      }
    },
    onError: (error) => toast.error(error.message || `Could not add “${entry.name}” back`),
  });

  return (
    <li className="flex items-center gap-1 rounded-md py-0.5 pr-1 pl-2 text-sm">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate" title={entry.name}>
          {entry.name}
        </span>
        {entry.detail && entry.detail !== entry.name && (
          <span className="text-muted-foreground truncate text-xs" title={entry.detail}>
            {entry.detail}
          </span>
        )}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={`Add ${entry.name} back to ${language}`}
        title={`Add back to ${language}`}
        disabled={addBack.isPending}
        onClick={() => addBack.mutate({ projectId, entity: entry.entity, id: entry.id })}
      >
        <Undo2Icon aria-hidden />
      </Button>
    </li>
  );
};
