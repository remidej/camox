import type { Block } from "./createBlock";
import type { Collection } from "./createCollection";
import type { Layout } from "./createLayout";

interface CreateAppOptions {
  blocks: Block[];
  layouts?: Layout[];
  collections?: Collection[];
}

export function createApp({ blocks, layouts = [], collections = [] }: CreateAppOptions) {
  const blocksMap = new Map<string, Block>();
  const layoutsMap = new Map<string, Layout>();
  const collectionsMap = new Map<string, Collection>();
  for (const collection of collections) {
    const id = collection._internal.id;
    if (collectionsMap.has(id)) throw new Error(`Duplicate collection: ${id}`);
    collectionsMap.set(id, collection);
  }

  for (const block of blocks) {
    blocksMap.set(block._internal.id, block);
  }

  const derivedPatterns = new Set<string>();
  for (const layout of layouts) {
    const { id, kind } = layout._internal;
    if (layoutsMap.has(id)) throw new Error(`Duplicate layout: ${id}`);
    if (kind !== "curated") {
      const pattern = id
        .split(".")
        .map((segment) => (segment.startsWith("$") ? "$" : segment))
        .join(".");
      if (derivedPatterns.has(pattern)) throw new Error(`Equivalent derived route: ${id}`);
      derivedPatterns.add(pattern);
    }
    layoutsMap.set(id, layout);
  }

  // Validate that at most one layout defines blocks.initial
  const layoutsWithInitialBlocks = layouts.filter((l) => l._internal.initialBlockBundles);
  if (layoutsWithInitialBlocks.length > 1) {
    const ids = layoutsWithInitialBlocks.map((l) => `"${l._internal.id}"`).join(", ");
    throw new Error(
      `[camox] Only one layout can define blocks.initial, but found ${layoutsWithInitialBlocks.length}: ${ids}`,
    );
  }

  return {
    getCollections() {
      return Array.from(collectionsMap.values());
    },
    getCollectionById(id: string) {
      return collectionsMap.get(id);
    },
    getSerializableCollectionDefinitions() {
      return Array.from(collectionsMap.values()).map(({ _internal }) => ({
        collectionId: _internal.id,
        title: _internal.title,
        description: _internal.description,
        label: _internal.label,
        contentSchema: JSON.parse(JSON.stringify(_internal.contentSchema)),
      }));
    },
    getBlocks() {
      return Array.from(blocksMap.values());
    },
    getBlockById(id: string) {
      return blocksMap.get(id);
    },
    getLayouts() {
      return Array.from(layoutsMap.values());
    },
    getLayoutById(id: string) {
      return layoutsMap.get(id);
    },
    getSerializableDefinitions() {
      return Array.from(blocksMap.values()).map((block) => ({
        blockId: block._internal.id,
        title: block._internal.title,
        description: block._internal.description,
        contentSchema: block._internal.contentSchema,
        settingsSchema: block._internal.settingsSchema,
        layoutOnly: block._internal.layoutOnly || undefined,
        synced: block._internal.synced,
      }));
    },
    getSerializableLayoutDefinitions() {
      return Array.from(layoutsMap.values()).map((layout) => ({
        layoutId: layout._internal.id,
        kind: layout._internal.kind,
        description: layout._internal.description,
        blocks: layout._internal.blockDefinitions,
      }));
    },
    getInitialPageBundles() {
      const layout = layoutsWithInitialBlocks[0];
      if (layout) {
        return {
          layoutId: layout._internal.id,
          blocks: layout._internal.initialBlockBundles!,
          hasInitialBlocks: true,
        };
      }
      const fallback = layouts.find((layout) => layout._internal.kind === "curated");
      if (!fallback) return null;
      return { layoutId: fallback._internal.id, blocks: [], hasInitialBlocks: false };
    },
  };
}

export type CamoxApp = ReturnType<typeof createApp>;
