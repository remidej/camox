import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { blockMutations, collectionMutations, repeatableItemMutations } from "@/lib/queries";

import { invalidateCollectionRecordViews } from "../../lib/collection-cache";
import { reads, type StudioCache, useStudioCache } from "../../lib/studio-reads";
import type { ReferenceRecord } from "../lib/reference";
import { referenceWritesFor } from "./referenceWrites";

/**
 * A change editing in place makes to content, as plain data: the page's block components make
 * them, wherever they render, and the studio writes them (ADR 0023: the studio is the only
 * writer of content).
 */
export type ContentEdit =
  | { type: "blockContent"; blockId: string; content: Record<string, unknown> }
  | { type: "itemContent"; itemId: string; content: Record<string, unknown> }
  /** One field of a record a block places, written to the shared record. */
  | {
      type: "recordField";
      projectUuid: string;
      record: ReferenceRecord;
      field: string;
      value: unknown;
    }
  /** A block whose definition was removed from code, deleted from its placeholder. */
  | { type: "deleteBlock"; blockId: string };

/** Writes an edit. Resolves once it is written, and rejects when it couldn't be. */
export type ApplyContentEdit = (edit: ContentEdit) => Promise<void>;

/**
 * The studio's way of writing edits: its draft-scoped mutations, so a write on Live starts a
 * draft, and its cache's updates, which every frame and sidebar shows.
 */
export function createContentEditor({
  queryClient,
  studioCache,
}: {
  queryClient: QueryClient;
  studioCache: StudioCache;
}): ApplyContentEdit {
  const run = <TVariables, TData>(
    options: { mutationFn?: unknown },
    variables: TVariables,
  ): Promise<TData> =>
    queryClient
      .getMutationCache()
      .build<TData, Error, TVariables, unknown>(queryClient, options as never)
      .execute(variables);

  return async (edit) => {
    switch (edit.type) {
      case "blockContent":
        await run(blockMutations.updateContent(), { id: edit.blockId, content: edit.content });
        return;
      case "itemContent":
        await run(repeatableItemMutations.updateContent(), {
          id: edit.itemId,
          content: edit.content,
        });
        return;
      case "deleteBlock":
        await run(blockMutations.delete(), { id: edit.blockId });
        return;
      case "recordField": {
        const { projectUuid, record, field, value } = edit;
        await referenceWritesFor(queryClient).save(record, field, value, async (input) => {
          const saved = await run<
            typeof input & { projectUuid: string },
            { id: string; content: Record<string, unknown> }
          >(collectionMutations.edit(), { ...input, projectUuid });
          studioCache.set(
            reads.record({ projectUuid, collectionId: record.collectionId, id: record.id }),
            saved as never,
          );
          // Shared source changes must refresh every placement, not only this block.
          void invalidateCollectionRecordViews(studioCache, projectUuid, record.collectionId);
          return saved;
        });
        return;
      }
    }
  };
}

/**
 * Where edits made in this document go, when not to the studio's own writer: the renderer frame
 * sends them to the studio.
 */
export const ContentEditsContext = React.createContext<ApplyContentEdit | null>(null);

/** How the block components of this document write their edits. */
export function useApplyContentEdit(): ApplyContentEdit {
  const sent = React.use(ContentEditsContext);
  const queryClient = useQueryClient();
  const studioCache = useStudioCache();
  const written = React.useMemo(
    () => createContentEditor({ queryClient, studioCache }),
    [queryClient, studioCache],
  );
  return sent ?? written;
}
