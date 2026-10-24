import type { TObject } from "@sinclair/typebox";

import { useProjectUuid } from "./auth";
import type { BlockDefinitionRow, Layout } from "./queries";
import { reads, useReadQuery } from "./studio-reads";

/**
 * The shown draft's definitions as the sidebars read them: plain data from the API, never the
 * website's code (ADR 0023). A draft reads its own definitions when it has them, else Live's
 * (ADR 0006). Anything needing a definition's code, such as a block's thumbnail, is not here.
 */

/** A block definition: what editing a block's content and settings needs. */
export interface BlockDefinition {
  id: string;
  title: string;
  description: string;
  contentSchema: TObject;
  settingsSchema: TObject | undefined;
  defaultContent: Record<string, unknown>;
  defaultSettings: Record<string, unknown>;
  layoutOnly: boolean;
  synced: boolean;
}

/** A layout definition: what choosing a layout and naming it needs. */
export interface LayoutDefinition {
  id: string;
  /** The name editors know it by; its id for a layout synced before titles were. */
  title: string;
  kind: Layout["kind"];
}

/** A collection definition: what editing its records and naming them needs. */
export interface CollectionDefinition {
  id: string;
  title: string;
  /** Templates of the record's fields, such as `{{name}}`. */
  toTitle: string;
  toDescription: string | null;
  contentSchema: TObject;
}

const toBlockDefinitions = (rows: BlockDefinitionRow[]) =>
  rows.map((row): BlockDefinition => ({
    id: row.blockId,
    title: row.title,
    description: row.description,
    contentSchema: row.contentSchema as TObject,
    settingsSchema: (row.settingsSchema ?? undefined) as TObject | undefined,
    defaultContent: (row.defaultContent ?? {}) as Record<string, unknown>,
    defaultSettings: (row.defaultSettings ?? {}) as Record<string, unknown>,
    layoutOnly: !!row.layoutOnly,
    synced: row.synced,
  }));

const toLayoutDefinitions = (rows: Layout[]) =>
  rows.map((row): LayoutDefinition => ({
    id: row.layoutId,
    title: row.title ?? row.layoutId,
    kind: row.kind,
  }));

function useProjectId() {
  const { data: project } = useReadQuery(reads.project({ projectUuid: useProjectUuid() }));
  return project?.id;
}

const NO_BLOCKS: BlockDefinition[] = [];
const NO_LAYOUTS: LayoutDefinition[] = [];

/** Every block definition, empty until they load. */
export function useBlockDefinitions(): BlockDefinition[] {
  const projectId = useProjectId();
  const { data } = useReadQuery(reads.blockDefinitionList({ projectId: projectId ?? 0 }), {
    enabled: projectId != null,
    select: toBlockDefinitions,
  });
  return data ?? NO_BLOCKS;
}

/** The definition of a block type, undefined while loading or when the draft has none. */
export function useBlockDefinition(type: string | undefined): BlockDefinition | undefined {
  const definitions = useBlockDefinitions();
  return type === undefined ? undefined : definitions.find((definition) => definition.id === type);
}

/** Every layout definition, empty until they load. */
export function useLayoutDefinitions(): LayoutDefinition[] {
  const projectId = useProjectId();
  const { data } = useReadQuery(reads.layoutList({ projectId: projectId ?? 0 }), {
    enabled: projectId != null,
    select: toLayoutDefinitions,
  });
  return data ?? NO_LAYOUTS;
}

/**
 * A layout definition, shaped as the route helpers (`core/derivedRoutes`, `core/pageDestinations`,
 * the Canvas's pages) read a layout's code: they only need what the definition syncs.
 */
export type RoutableLayout = { _internal: LayoutDefinition };

const NO_ROUTABLE_LAYOUTS: RoutableLayout[] = [];
const toRoutableLayouts = (rows: Layout[]) =>
  toLayoutDefinitions(rows).map((definition): RoutableLayout => ({ _internal: definition }));

/** Every layout definition, as the route helpers read layouts: empty until they load. */
export function useRoutableLayouts(): RoutableLayout[] {
  const projectId = useProjectId();
  const { data } = useReadQuery(reads.layoutList({ projectId: projectId ?? 0 }), {
    enabled: projectId != null,
    select: toRoutableLayouts,
  });
  return data ?? NO_ROUTABLE_LAYOUTS;
}

/** The definition of a layout, undefined while loading or when the draft has none. */
export function useLayoutDefinition(id: string | undefined): LayoutDefinition | undefined {
  const definitions = useLayoutDefinitions();
  return id === undefined ? undefined : definitions.find((definition) => definition.id === id);
}

const toCollectionDefinition = (row: {
  collectionId: string;
  title: string;
  toTitle: string;
  toDescription: string | null;
  contentSchema: unknown;
}): CollectionDefinition => ({
  id: row.collectionId,
  title: row.title,
  toTitle: row.toTitle,
  toDescription: row.toDescription,
  contentSchema: row.contentSchema as TObject,
});

/** The definition of a collection, undefined while loading or when the draft has none. */
export function useCollectionDefinition(
  collectionId: string | undefined,
): CollectionDefinition | undefined {
  const projectUuid = useProjectUuid();
  return useReadQuery(reads.collection({ projectUuid, collectionId: collectionId ?? "" }), {
    enabled: collectionId != null,
    select: toCollectionDefinition,
  }).data;
}
