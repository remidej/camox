import type { Block } from "./createBlock";
import type { Collection } from "./createCollection";
import type { Layout } from "./createLayout";
import type { CamoxDocument } from "./defineDocument";
import { artifactFontLinks } from "./lib/artifact";

interface CreateAppOptions {
  blocks: Block[];
  /**
   * Blocks loaded on demand, keyed by their file name, which is their id by convention. A
   * block id without a matching key is found by loading every block.
   */
  lazyBlocks?: Record<string, () => Promise<Block | undefined>>;
  layouts?: Layout[];
  collections?: Collection[];
  /** The project's document definition (`src/document.ts`). */
  document?: CamoxDocument;
}

export function createApp({
  blocks,
  lazyBlocks = {},
  layouts = [],
  collections = [],
  document,
}: CreateAppOptions) {
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

  const lazyBlockLoads = new Map<string, Promise<Block | undefined>>();
  const loadLazyBlock = (key: string) => {
    let load = lazyBlockLoads.get(key);
    if (!load) {
      load = lazyBlocks[key]!().then((block) => {
        // A file in the blocks directory may not export a block.
        if (block) blocksMap.set(block._internal.id, block);
        return block;
      });
      lazyBlockLoads.set(key, load);
      // A failed chunk fetch must not stick: a later render or navigation retries it.
      load.catch(() => lazyBlockLoads.delete(key));
    }
    return load;
  };
  let allBlocksLoaded = Object.keys(lazyBlocks).length === 0;
  let allBlocksLoad: Promise<void> | undefined;
  const loadAllBlocks = () => {
    if (!allBlocksLoad) {
      allBlocksLoad = Promise.all(Object.keys(lazyBlocks).map(loadLazyBlock)).then(() => {
        allBlocksLoaded = true;
      });
      allBlocksLoad.catch(() => (allBlocksLoad = undefined));
    }
    return allBlocksLoad;
  };
  // One promise per id, so a suspended render waits on the same load when it retries.
  const blockLoads = new Map<string, Promise<Block | undefined>>();
  const loadBlock = (id: string): Promise<Block | undefined> => {
    let load = blockLoads.get(id);
    if (!load) {
      load = (async () => {
        const loaded = blocksMap.get(id);
        if (loaded) return loaded;
        if (Object.hasOwn(lazyBlocks, id)) {
          const block = await loadLazyBlock(id);
          if (block?._internal.id === id) return block;
        }
        await loadAllBlocks();
        return blocksMap.get(id);
      })();
      blockLoads.set(id, load);
      load.catch(() => blockLoads.delete(id));
    }
    return load;
  };

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
  const layoutsWithInitialBlocks = layouts.filter((l) => l._internal.loadInitialBlockBundles);
  if (layoutsWithInitialBlocks.length > 1) {
    const ids = layoutsWithInitialBlocks.map((l) => `"${l._internal.id}"`).join(", ");
    throw new Error(
      `[camox] Only one layout can define blocks.initial, but found ${layoutsWithInitialBlocks.length}: ${ids}`,
    );
  }

  const fontLinks = artifactFontLinks(document);

  /** Loads the initial blocks' modules: only syncing needs them, never a page. */
  const getHomepage = async () => {
    const layout = layoutsWithInitialBlocks[0];
    if (layout) {
      return {
        layoutId: layout._internal.id,
        blocks: await layout._internal.loadInitialBlockBundles!(),
        hasInitialBlocks: true,
      };
    }
    const fallback = layouts.find((layout) => layout._internal.kind === "curated");
    if (!fallback) return null;
    return { layoutId: fallback._internal.id, blocks: [], hasInitialBlocks: false };
  };

  return {
    /** The document's font links as HTML, for artifacts to load before their source. */
    getArtifactFontLinks() {
      return fontLinks;
    },
    getCollections() {
      return Array.from(collectionsMap.values());
    },
    getCollectionById(id: string) {
      return collectionsMap.get(id);
    },
    /** The loaded blocks: every block after `loadAllBlocks`. */
    getBlocks() {
      return Array.from(blocksMap.values());
    },
    /** A loaded block. Call `loadBlock` first for a block that may be lazy. */
    getBlockById(id: string) {
      return blocksMap.get(id);
    },
    loadBlock,
    /** Whether a block not loaded yet could still load, rather than not exist. */
    canLoadMoreBlocks() {
      return !allBlocksLoaded;
    },
    async loadBlocks(ids: Iterable<string>) {
      await Promise.all([...new Set(ids)].map(loadBlock));
    },
    /** Every block definition, which editing needs, rather than only a page's. */
    loadAllBlocks,
    getLayouts() {
      return Array.from(layoutsMap.values());
    },
    getLayoutById(id: string) {
      return layoutsMap.get(id);
    },
    /**
     * The website's Definition Set: every block (lazy ones included, layout-only ones only when a
     * layout declares them), layout and collection definition, and the homepage they declare.
     * Never calls the network; the API computes schema hashes on write.
     */
    async getDefinitionSet() {
      await loadAllBlocks();
      const layoutDefinitions = Array.from(layoutsMap.values()).map((layout) => ({
        layoutId: layout._internal.id,
        kind: layout._internal.kind,
        title: layout._internal.title,
        description: layout._internal.description,
        blocks: layout._internal.blockDefinitions,
        ...(layout._internal.recordPages && {
          recordPages: {
            collectionId: layout._internal.recordPages.collectionId,
            field: layout._internal.recordPages.field,
          },
        }),
      }));
      const typesUsedInLayouts = new Set(
        layoutDefinitions.flatMap((layout) => layout.blocks.map((block) => block.type)),
      );
      // Layout-only blocks mean nothing unless a layout places them: syncing the others would
      // leave definitions no editor can ever add.
      const blockDefinitions = Array.from(blocksMap.values())
        .filter(
          (block) => !block._internal.layoutOnly || typesUsedInLayouts.has(block._internal.id),
        )
        .map(({ _internal }) => ({
          blockId: _internal.id,
          title: _internal.title,
          description: _internal.description,
          contentSchema: _internal.contentSchema,
          settingsSchema: _internal.settingsSchema,
          defaultContent: _internal.getInitialContent(),
          defaultSettings: _internal.getInitialSettings(),
          layoutOnly: _internal.layoutOnly || undefined,
          synced: _internal.synced,
        }));
      const collectionDefinitions = Array.from(collectionsMap.values()).map(({ _internal }) => ({
        collectionId: _internal.id,
        title: _internal.title,
        description: _internal.description,
        toTitle: _internal.toTitle,
        toDescription: _internal.toDescription,
        ...(_internal.toStructuredData && { toStructuredData: _internal.toStructuredData }),
        contentSchema: JSON.parse(JSON.stringify(_internal.contentSchema)),
      }));
      return {
        blocks: blockDefinitions,
        layouts: layoutDefinitions,
        collections: collectionDefinitions,
        homepage: await getHomepage(),
      };
    },
  };
}

export type CamoxApp = ReturnType<typeof createApp>;

/** All of a website's definitions taken together, with the content they declare. */
export type DefinitionSet = Awaited<ReturnType<CamoxApp["getDefinitionSet"]>>;
