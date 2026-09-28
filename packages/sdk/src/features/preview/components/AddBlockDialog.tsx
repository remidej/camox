import { queryKeys } from "@camox/api-contract/query-keys";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@camox/ui/dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "@xstate/store-react";
import { generateKeyBetween } from "fractional-indexing";
import * as React from "react";

import type { Block } from "@/core/createBlock";
import { useRequireDraftSource } from "@/core/hooks/useRequireDraftSource";
import { useLocation } from "@/features/navigation/navigation";
import { useProjectSlug } from "@/lib/auth";
import { usePageBlocks } from "@/lib/normalized-data";
import {
  type BlockBundle,
  type PageStructure,
  blockMutations,
  blockQueries,
  projectQueries,
} from "@/lib/queries";

import { useCamoxApp } from "../../provider/components/CamoxAppContext";
import { usePreviewedPage } from "../CamoxPreview";
import { previewStore, sameEditingOwner } from "../previewStore";
import { getGridNavigationIndex } from "./blockGridNavigation";
import { BlockThumbnail } from "./BlockThumbnail";

const AddBlockDialog = ({ focusCreatedBlock = true }: { focusCreatedBlock?: boolean }) => {
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
  const dialog = useSelector(previewStore, (state) => state.context.addBlockDialog);
  const queryClient = useQueryClient();
  const { pathname } = useLocation();
  const requireDraft = useRequireDraftSource();

  const createBlock = useMutation({
    ...blockMutations.create(),
    onMutate: (variables) => {
      // Optimistic insert lands in the draft cache slot only — edits never
      // touch the live snapshot. See useUpdateBlockPosition for the same
      // pattern.
      const pageQueryKey = queryKeys.pages.getByPath(pathname, "draft");
      const previousPage = queryClient.getQueryData<PageStructure>(pageQueryKey);
      if (!previousPage) return { pageQueryKey };

      // Read block positions from individual caches for position computation
      const blockIds = previousPage.page.blockIds;
      const pageBlocks = blockIds
        .map(
          (id) => queryClient.getQueryData<BlockBundle>(queryKeys.blocks.get(id, "draft"))?.block,
        )
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
      const optimisticId = -now;
      const optimisticBlock = {
        id: optimisticId,
        pageId: variables.pageId,
        layoutId: null,
        type: variables.type,
        content: variables.content as Record<string, unknown>,
        settings: (variables.settings as Record<string, unknown>) ?? null,
        placement: null,
        summary: "",
        position,
        createdAt: now,
        updatedAt: now,
      };

      // Seed the optimistic block's individual cache
      queryClient.setQueryData(queryKeys.blocks.get(optimisticId, "draft"), {
        block: optimisticBlock,
        repeatableItems: [],
        files: [],
      });

      // Insert at the correct position in blockIds
      const insertIndex = pageBlocks.findIndex((b) => b.position > position);
      const newBlockIds = [...blockIds];
      if (insertIndex === -1) {
        newBlockIds.push(optimisticId);
      } else {
        newBlockIds.splice(insertIndex, 0, optimisticId);
      }

      queryClient.setQueryData<PageStructure>(pageQueryKey, {
        ...previousPage,
        page: { ...previousPage.page, blockIds: newBlockIds },
      });

      void queryClient.cancelQueries({ queryKey: pageQueryKey });
      return { previousPage, optimisticId, pageQueryKey };
    },
    onError: (_error, _variables, context) => {
      if (context?.previousPage) {
        queryClient.setQueryData(context.pageQueryKey, context.previousPage);
      }
      if (context?.optimisticId) {
        queryClient.removeQueries({
          queryKey: queryKeys.blocks.get(context.optimisticId, "draft"),
        });
      }
    },
    onSettled: (_data, _error, _variables, context) => {
      if (!context) return;
      void queryClient.invalidateQueries({
        queryKey: context.pageQueryKey,
      });
    },
  });

  const projectSlug = useProjectSlug();
  const { data: project } = useQuery(projectQueries.getBySlug(projectSlug));
  const availableBlocks = useCamoxApp()
    .getBlocks()
    .filter((b) => !b._internal.layoutOnly);
  const page = usePreviewedPage();
  const { pageBlocks } = usePageBlocks(page);
  const { data: totalCounts = {} } = useQuery({
    ...blockQueries.getUsageCounts(project?.id ?? 0),
    enabled: !!project,
  });
  // Keep ordering in React rather than letting cmdk reorder the thumbnail DOM.
  // This also makes the first keyboard selection match the highest search score.
  const filteredBlocks = availableBlocks
    .map((block) => ({
      block,
      score: search.trim()
        ? commandFilter(block._internal.id, search.trim(), [
            block._internal.title,
            block._internal.description ?? "",
          ])
        : 1,
    }))
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (totalCounts[b.block._internal.id] ?? 0) - (totalCounts[a.block._internal.id] ?? 0),
    )
    .map(({ block }) => block);
  const selectedValue = filteredBlocks.some((block) => block._internal.id === highlightedValue)
    ? highlightedValue
    : (filteredBlocks[0]?._internal.id ?? "");

  const pageCounts = React.useMemo(() => {
    const counts: Record<string, number> = {};
    if (!page) return counts;
    for (const block of pageBlocks) {
      counts[block.type] = (counts[block.type] ?? 0) + 1;
    }
    return counts;
  }, [page, pageBlocks]);

  React.useEffect(() => {
    setHighlightedValue("");
    setSearch("");
    setError(null);
  }, [dialog]);

  const handleAddBlock = async (block: Block) => {
    if (!page || !dialog || submitting.current) return;
    if (!requireDraft()) return;

    submitting.current = true;
    setError(null);
    const owner = { kind: "page", pageId: page.page.id } as const;
    try {
      const bundle = block._internal.getInitialBundle();
      const { id: blockId } = await createBlock.mutateAsync({
        pageId: page.page.id,
        type: block._internal.id,
        content: bundle.content,
        settings: bundle.settings,
        afterPosition: dialog.afterPosition,
        repeatableItems: bundle.repeatableItems,
      });
      // A completed insertion must not steal focus after navigating away,
      // or close a different picker opened while this request was in flight.
      const context = previewStore.getSnapshot().context;
      if (!mounted.current) return;
      if (focusCreatedBlock && !sameEditingOwner(context.editingContext, owner)) return;
      if (context.addBlockDialog !== dialog) return;
      previewStore.send({ type: "closeAddBlockDialog" });
      if (focusCreatedBlock) previewStore.send({ type: "focusCreatedBlock", ...owner, blockId });
    } catch {
      if (previewStore.getSnapshot().context.addBlockDialog === dialog) {
        setError("Could not add this block. Please try again.");
      }
    } finally {
      submitting.current = false;
    }
  };

  const displayCount = (blockId: Block["_internal"]["id"]) => {
    const total = totalCounts[blockId] ?? 0;
    if (total === 0) return "Never used";
    const page = pageCounts[blockId] ?? "none";
    return `${total} use${total > 1 ? "s" : ""} (${page} here)`;
  };

  return (
    <Dialog
      open={dialog != null}
      onOpenChange={(open) => {
        if (!open && !submitting.current) {
          previewStore.send({ type: "closeAddBlockDialog" });
        }
      }}
    >
      <DialogContent className="flex h-[min(85dvh,900px)] flex-col gap-4 overflow-hidden sm:max-w-6xl">
        <DialogHeader className="pr-8">
          <DialogTitle>Add a block</DialogTitle>
          <DialogDescription>
            Search blocks, use the arrow keys to browse, and press Enter to add.
          </DialogDescription>
        </DialogHeader>
        <Command
          label="Search blocks"
          shouldFilter={false}
          value={selectedValue}
          onValueChange={setHighlightedValue}
          className="h-0 min-h-0 flex-1 rounded-none! bg-transparent! p-0!"
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
            className="mt-4 max-h-none min-h-0 flex-1 pb-2"
            aria-busy={createBlock.isPending}
          >
            <CommandEmpty>No blocks found.</CommandEmpty>
            <CommandGroup
              ref={gridRef}
              className="p-0 [&>[cmdk-group-items]]:grid [&>[cmdk-group-items]]:grid-cols-1 [&>[cmdk-group-items]]:gap-4 sm:[&>[cmdk-group-items]]:grid-cols-2 lg:[&>[cmdk-group-items]]:grid-cols-3"
            >
              {filteredBlocks.map((block: Block) => (
                <CommandItem
                  key={block._internal.id}
                  value={block._internal.id}
                  keywords={[block._internal.title, block._internal.description ?? ""]}
                  disabled={createBlock.isPending}
                  hideCheck
                  onSelect={() => {
                    void handleAddBlock(block);
                  }}
                  className="group bg-card data-[selected=true]:border-primary flex flex-col items-stretch gap-0 overflow-hidden rounded-lg border-2 p-0"
                >
                  <BlockThumbnail block={block} className="h-44" />
                  <div className="border-border flex flex-col gap-1 border-t px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 leading-5 font-medium">{block._internal.title}</span>
                      {block._internal.synced && (
                        <Badge variant="secondary" size="sm">
                          Synced
                        </Badge>
                      )}
                    </div>
                    <span className="text-muted-foreground text-xs leading-4">
                      {displayCount(block._internal.id)}
                    </span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        {createBlock.isPending && <p role="status">Adding block…</p>}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
};

export { AddBlockDialog };
