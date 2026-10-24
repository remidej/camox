import { generateUuidv7 } from "@camox/api-contract/ids";
import { Badge } from "@camox/ui/badge";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  commandFilter,
} from "@camox/ui/command";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@camox/ui/sheet";
import { useMutation } from "@tanstack/react-query";
import { useSelector } from "@xstate/store-react";
import { generateKeyBetween } from "fractional-indexing";
import * as React from "react";

import { useProjectUuid } from "@/lib/auth";
import { usePageBlocks } from "@/lib/normalized-data";
import { type BlockBundle, blockMutations } from "@/lib/queries";
import { type BlockDefinition, useBlockDefinitions } from "@/lib/studio-definitions";
import { useLocalePath } from "@/lib/view-locale";

import { reads, useReadQuery, useStudioCache } from "../../../lib/studio-reads";
import type { RendererAnswer } from "../../renderer/protocol";
import { useRendererHost } from "../../renderer/RendererFrames";
import type { RendererHost } from "../../renderer/rendererHost";
import { usePreviewedPage } from "../CamoxPreview";
import { previewStore, sameEditingOwner } from "../previewStore";
import { getGridNavigationIndex } from "./blockGridNavigation";
import { BlockThumbnail } from "./BlockThumbnail";

const AddBlockSheet = ({ focusCreatedBlock = true }: { focusCreatedBlock?: boolean }) => {
  const [highlightedValue, setHighlightedValue] = React.useState<string>("");
  const [search, setSearch] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const submitting = React.useRef(false);
  const mounted = React.useRef(false);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const gridRef = React.useRef<HTMLDivElement>(null);
  const sheet = useSelector(previewStore, (state) => state.context.addBlockSheet);
  const studioCache = useStudioCache();
  const projectUuid = useProjectUuid();
  const pathname = useLocalePath();

  const createBlock = useMutation({
    ...blockMutations.create(),
    onMutate: (variables) => {
      // Optimistic insert, like useUpdateBlockPosition.
      const edit = studioCache.edit();
      const page = reads.pageStructure({ path: pathname, projectUuid });
      const previousPage = edit.get(page);
      if (!previousPage) return { edit };

      // Read block positions from individual caches for position computation
      const blockIds = previousPage.page.blockIds;
      const pageBlocks = blockIds
        .map((id) => edit.get(reads.blockBundle(id))?.block)
        .filter((b) => b != null);
      const { afterPosition } = variables;

      let position: string;
      if (afterPosition == null) {
        const lastBlock = pageBlocks[pageBlocks.length - 1];
        position = generateKeyBetween(lastBlock?.position ?? null, null);
      } else if (afterPosition === "") {
        const firstBlock = pageBlocks[0];
        position = generateKeyBetween(null, firstBlock?.position ?? null);
      } else {
        let afterIndex = -1;
        for (let i = pageBlocks.length - 1; i >= 0; i--) {
          if (String(pageBlocks[i].position) <= afterPosition) {
            afterIndex = i;
            break;
          }
        }
        const nextBlock = afterIndex >= 0 ? pageBlocks[afterIndex + 1] : pageBlocks[0];
        position = generateKeyBetween(
          afterIndex >= 0 ? pageBlocks[afterIndex].position : null,
          nextBlock?.position ?? null,
        );
      }

      const now = Date.now();
      // The client mints the id, so the optimistic block is the block the server creates.
      const optimisticId = variables.id ?? generateUuidv7();
      const optimisticBlock = {
        id: optimisticId,
        pageId: variables.pageId,
        layoutId: null,
        type: variables.type,
        content: variables.content as Record<string, unknown>,
        settings: (variables.settings as Record<string, unknown>) ?? null,
        slot: null,
        summary: "",
        title: "",
        position,
        createdAt: now,
        updatedAt: now,
      };

      // Seed the optimistic block's own read. It lacks the block's repeatable items, so
      // settling refetches the created block.
      edit.set(reads.blockBundle(optimisticId), {
        block: optimisticBlock,
        repeatableItems: [],
        files: [],
      } as unknown as BlockBundle);

      // Insert at the correct position in blockIds
      const insertIndex = pageBlocks.findIndex((b) => b.position > position);
      const newBlockIds = [...blockIds];
      if (insertIndex === -1) {
        newBlockIds.push(optimisticId);
      } else {
        newBlockIds.splice(insertIndex, 0, optimisticId);
      }

      edit.set(page, { ...previousPage, page: { ...previousPage.page, blockIds: newBlockIds } });
      return { edit };
    },
    onError: (_error, _variables, context) => context?.edit.rollback(),
    onSettled: (_data, _error, _variables, context) => context?.edit.settle(),
  });

  const { data: project } = useReadQuery(reads.project({ projectUuid }));
  // A new block's initial content needs the block's code, so it's asked of the renderer frame.
  const rendererHost = useRendererHost();
  const availableBlocks = useBlockDefinitions().filter((block) => !block.layoutOnly);
  const page = usePreviewedPage();
  const { pageBlocks } = usePageBlocks(page);
  const { data: totalCounts = {} } = useReadQuery(
    reads.blockUsageCounts({ projectId: project?.id ?? 0 }),
    { enabled: !!project },
  );
  // Keep ordering in React rather than letting cmdk reorder the thumbnail DOM.
  // This also makes the first keyboard selection match the highest search score.
  const filteredBlocks = availableBlocks
    .map((block) => ({
      block,
      score: search.trim()
        ? commandFilter(block.id, search.trim(), [block.title, block.description])
        : 1,
    }))
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || (totalCounts[b.block.id] ?? 0) - (totalCounts[a.block.id] ?? 0),
    )
    .map(({ block }) => block);
  const selectedValue = filteredBlocks.some((block) => block.id === highlightedValue)
    ? highlightedValue
    : (filteredBlocks[0]?.id ?? "");

  const pageCounts = React.useMemo(() => {
    const counts: Record<string, number> = {};
    if (!page) return counts;
    for (const block of pageBlocks) {
      counts[block.type] = (counts[block.type] ?? 0) + 1;
    }
    return counts;
  }, [page, pageBlocks]);

  // Each sheet opening starts fresh.
  const [previousSheet, setPreviousSheet] = React.useState(sheet);
  if (sheet !== previousSheet) {
    setPreviousSheet(sheet);
    setHighlightedValue("");
    setSearch("");
    setError(null);
  }

  const handleAddBlock = async (block: BlockDefinition) => {
    if (!page || !sheet || submitting.current) return;

    submitting.current = true;
    setError(null);
    const owner = { kind: "page", pageId: page.page.id } as const;
    try {
      // The block's code builds its initial content, in the renderer frame, which runs the
      // draft's code. Without it, the synced defaults, with no repeatable items.
      const fromCode = rendererHost ? await initialBundleFrom(rendererHost, block.id) : null;
      const bundle = fromCode ?? {
        content: block.defaultContent,
        settings: block.defaultSettings,
        repeatableItems: [],
      };
      const { id: blockId } = await createBlock.mutateAsync({
        id: generateUuidv7(),
        pageId: page.page.id,
        type: block.id,
        content: bundle.content,
        settings: bundle.settings,
        afterPosition: sheet.afterPosition,
        repeatableItems: bundle.repeatableItems,
      });
      // A completed insertion must not steal focus after navigating away,
      // or close a different picker opened while this request was in flight.
      const context = previewStore.getSnapshot().context;
      if (!mounted.current) return;
      if (focusCreatedBlock && !sameEditingOwner(context.editingContext, owner)) return;
      if (context.addBlockSheet !== sheet) return;
      previewStore.send({ type: "closeAddBlockSheet" });
      if (focusCreatedBlock) previewStore.send({ type: "focusCreatedBlock", ...owner, blockId });
    } catch {
      if (previewStore.getSnapshot().context.addBlockSheet === sheet) {
        setError("Could not add this block. Please try again.");
      }
    } finally {
      submitting.current = false;
    }
  };

  const displayCount = (blockId: string) => {
    const total = totalCounts[blockId] ?? 0;
    if (total === 0) return "Never used";
    const page = pageCounts[blockId] ?? "none";
    return `${total} use${total > 1 ? "s" : ""} (${page} here)`;
  };

  return (
    <Sheet
      open={sheet != null}
      onOpenChange={(open) => {
        if (!open && !submitting.current) {
          previewStore.send({ type: "closeAddBlockSheet" });
        }
      }}
    >
      {/* Wide enough for three thumbnails per row. */}
      <SheetContent
        side="right"
        className="gap-0 overflow-hidden data-[side=right]:w-full data-[side=right]:sm:max-w-4xl"
      >
        <SheetHeader className="pr-12">
          <SheetTitle>Add a block</SheetTitle>
          <SheetDescription>
            Search blocks, use the arrow keys to browse, and press Enter to add.
          </SheetDescription>
        </SheetHeader>
        <Command
          label="Search blocks"
          shouldFilter={false}
          value={selectedValue}
          onValueChange={setHighlightedValue}
          className="h-0 min-h-0 flex-1 rounded-none! bg-transparent! px-4! pt-0! pb-0!"
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
            if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
            e.preventDefault();
            const grid = gridRef.current?.querySelector<HTMLElement>("[cmdk-group-items]");
            if (!grid || submitting.current) return;
            // Read the rendered, filtered order and actual CSS column count,
            // so keyboard movement follows the responsive layout after resizing.
            const items = Array.from(
              grid.querySelectorAll<HTMLElement>('[cmdk-item]:not([data-disabled="true"])'),
            );
            const columns = getComputedStyle(grid).gridTemplateColumns.split(" ").length;
            const index = items.findIndex((item) => item.dataset.selected === "true");
            const next = getGridNavigationIndex(index, items.length, columns, e.key);
            const item = items[next];
            if (!item) return;
            setHighlightedValue(item.dataset.value ?? "");
            item.scrollIntoView({ block: "nearest" });
          }}
        >
          <CommandInput
            placeholder="Search blocks..."
            aria-label="Search blocks"
            value={search}
            onValueChange={(value) => {
              setSearch(value);
              setHighlightedValue("");
            }}
            className="px-0 pt-0"
            autoFocus
          />
          <CommandList
            label="Available blocks"
            className="mt-4 max-h-none min-h-0 flex-1 pb-4"
            aria-busy={createBlock.isPending}
          >
            <CommandEmpty>No blocks found.</CommandEmpty>
            <CommandGroup
              ref={gridRef}
              className="@container p-0 [&>[cmdk-group-items]]:grid [&>[cmdk-group-items]]:grid-cols-1 [&>[cmdk-group-items]]:gap-4 @xl:[&>[cmdk-group-items]]:grid-cols-2 @3xl:[&>[cmdk-group-items]]:grid-cols-3"
            >
              {filteredBlocks.map((block) => (
                <CommandItem
                  key={block.id}
                  value={block.id}
                  keywords={[block.title, block.description]}
                  disabled={createBlock.isPending}
                  hideCheck
                  onSelect={() => {
                    void handleAddBlock(block);
                  }}
                  className="group bg-card data-[selected=true]:border-primary flex flex-col items-stretch gap-0 overflow-hidden rounded-lg border-2 p-0"
                >
                  <BlockThumbnail blockType={block.id} title={block.title} className="h-44" />
                  <div className="border-border flex flex-col gap-1 border-t px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 leading-5 font-medium">{block.title}</span>
                      {block.synced && (
                        <Badge variant="secondary" size="sm">
                          Synced
                        </Badge>
                      )}
                    </div>
                    <span className="text-muted-foreground text-xs leading-4">
                      {displayCount(block.id)}
                    </span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        {(createBlock.isPending || error) && (
          <div className="border-border border-t p-4">
            {createBlock.isPending && <p role="status">Adding block…</p>}
            {error && (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
};

export { AddBlockSheet };

/**
 * How long adding a block waits for the renderer frame to give the block's initial content
 * before it uses the synced defaults. A tuning value.
 */
export const INITIAL_BUNDLE_WAIT_MS = 3_000;

type InitialBundleAnswer = RendererAnswer<{ type: "initialBundle"; blockType: string }>;

/**
 * The initial content a `blockType` block's code builds, asked of the renderer frame. Null,
 * for the synced defaults, when the renderer runs another SDK version, which answers nothing,
 * or hasn't answered within `INITIAL_BUNDLE_WAIT_MS`, as when it never connects.
 */
function initialBundleFrom(host: RendererHost, blockType: string): Promise<InitialBundleAnswer> {
  return new Promise((resolve, reject) => {
    const settle = (bundle: InitialBundleAnswer) => {
      clearTimeout(timeout);
      stopWatching();
      resolve(bundle);
    };
    const timeout = setTimeout(() => settle(null), INITIAL_BUNDLE_WAIT_MS);
    const watch = () => {
      if (host.status() === "updating") settle(null);
    };
    const stopWatching = host.subscribeStatus(watch);
    watch();
    host.ask({ type: "initialBundle", blockType }).then(settle, (error: unknown) => {
      clearTimeout(timeout);
      stopWatching();
      reject(error);
    });
  });
}
