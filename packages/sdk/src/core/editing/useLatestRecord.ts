import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import { useProjectSlug } from "@/lib/auth";
import { collectionQueries } from "@/lib/queries";

import { latestDraft, type ReferenceRecord, type SavedRecord } from "../lib/reference";
import { fieldPlainText } from "../recordItem";
import type { LoadedRecord } from "../requestContext";

/**
 * A record page's record as the Studio shows it: as its loader returned it, or as a later save
 * through any placement stored it in the shared record cache. Undefined without a record.
 */
export function useLatestRecord({
  collectionId,
  labelField,
  loaded,
}: {
  collectionId: string;
  /** The collection's label field. */
  labelField: string;
  loaded: LoadedRecord | undefined;
}): ReferenceRecord | undefined {
  const projectSlug = useProjectSlug();
  const { data: saved } = useQuery<SavedRecord>({
    queryKey: collectionQueries.record(projectSlug, collectionId, loaded?.id ?? "").queryKey,
    enabled: false,
  });
  return React.useMemo(() => {
    if (!loaded) return undefined;
    const { content, version } = latestDraft(loaded, saved);
    return {
      id: loaded.id,
      collectionId,
      label: fieldPlainText(content[labelField]),
      content,
      references: loaded.references,
      version,
    };
  }, [collectionId, labelField, loaded, saved]);
}
