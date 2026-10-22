import * as React from "react";

import { useProjectUuid } from "@/lib/auth";

import { reads, useReadQuery } from "../../lib/studio-reads";
import type { Collection } from "../createCollection";
import { latestContent, type ReferenceRecord } from "../lib/reference";
import { recordText } from "../recordItem";
import type { LoadedRecord } from "../requestContext";

/**
 * A record page's record as the Studio shows it: as its loader returned it, or as a later save
 * through any placement stored it in the shared record cache. Undefined without a record.
 */
export function useLatestRecord({
  collectionId,
  collection,
  loaded,
}: {
  collectionId: string;
  /** The record's collection, whose templates title and describe the record as edited. */
  collection: Collection | undefined;
  loaded: LoadedRecord | undefined;
}): ReferenceRecord | undefined {
  const projectUuid = useProjectUuid();
  // Only what saves store: the record page's loader read the record already.
  const { data: saved } = useReadQuery(
    reads.record({ projectUuid, collectionId, id: loaded?.id ?? "" }),
    {
      enabled: false,
    },
  );
  return React.useMemo(() => {
    if (!loaded) return undefined;
    const { content, updatedAt } = latestContent(loaded, saved);
    return {
      id: loaded.id,
      collectionId,
      ...recordText(collection, content),
      content,
      references: loaded.references,
      updatedAt,
    };
  }, [collection, collectionId, loaded, saved]);
}
