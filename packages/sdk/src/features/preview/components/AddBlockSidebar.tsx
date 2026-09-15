import { queryKeys } from "@camox/api-contract/query-keys";
import { Badge } from "@camox/ui/badge";
import { Button } from "@camox/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@camox/ui/command";
import { PanelContent } from "@camox/ui/panel";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "@xstate/store-react";
import { generateKeyBetween } from "fractional-indexing";
import { ArrowLeft } from "lucide-react";
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
import { trackClientEvent } from "@/lib/telemetry-client";

import { useCamoxApp } from "../../provider/components/CamoxAppContext";
import { usePreviewedPage } from "../CamoxPreview";
import { previewStore } from "../previewStore";
import { BlockThumbnail } from "./BlockThumbnail";

const AddBlockSidebar = () => {
  const [highlightedValue, setHighlightedValue] = React.useState<string>("");
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
      if (!previousPage) return {};

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
      return { previousPage, optimisticId };
    },
    onError: (_error, _variables, context) => {
      if (context?.previousPage) {
        queryClient.setQueryData(
          queryKeys.pages.getByPath(pathname, "draft"),
          context.previousPage,
        );
      }
      if (context?.optimisticId) {
        queryClient.removeQueries({
          queryKey: queryKeys.blocks.get(context.optimisticId, "draft"),
        });
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.pages.getByPath(pathname, "draft"),
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

  const pageCounts = React.useMemo(() => {
    const counts: Record<string, number> = {};
    if (!page) return counts;
    for (const block of pageBlocks) {
      counts[block.type] = (counts[block.type] ?? 0) + 1;
    }
    return counts;
  }, [page, pageBlocks]);

  const peekedBlockPosition = useSelector(
    previewStore,
    (state) => state.context.peekedBlockPosition,
  );
  const addBlockSource = useSelector(previewStore, (state) => state.context.addBlockSource);

  const handleAddBlock = async (block: Block) => {
    if (!page) return;
    if (!requireDraft()) return;

    const afterPosition =
      peekedBlockPosition === ""
        ? ""
        : (peekedBlockPosition ?? pageBlocks[pageBlocks.length - 1]?.position);

    const bundle = block._internal.getInitialBundle();
    const { id: blockId } = await createBlock.mutateAsync({
      pageId: page.page.id,
      type: block._internal.id,
      content: bundle.content,
      settings: bundle.settings,
      afterPosition,
      repeatableItems: bundle.repeatableItems,
    });
    trackClientEvent("block_added", {
      blockType: block._internal.id,
      via: addBlockSource ?? "unknown",
    });
    previewStore.send({ type: "focusCreatedBlock", blockId });
    previewStore.send({ type: "exitPeekedBlock" });
  };

  const handlePreviewBlock = (block: Block) => {
    const afterPosition =
      peekedBlockPosition === ""
        ? ""
        : (peekedBlockPosition ?? pageBlocks[pageBlocks.length - 1]?.position);

    previewStore.send({ type: "setPeekedBlock", block, afterPosition });
  };

  const handleValueChange = (value: string) => {
    setHighlightedValue(value);
    const block = availableBlocks.find((b: Block) => b._internal.title === value);
    if (block) {
      handlePreviewBlock(block);
    } else {
      previewStore.send({ type: "clearPeekedBlock" });
    }
  };

  const displayCount = (blockId: Block["_internal"]["id"]) => {
    const total = totalCounts[blockId] ?? 0;
    if (total === 0) return "Never used";
    const page = pageCounts[blockId] ?? "none";
    return `${total} use${total > 1 ? "s" : ""} (${page} here)`;
  };

  return (
    <>
      <div className="px-2 pt-4">
        <Button
          variant="ghost"
          className="w-full justify-start"
          onClick={() => previewStore.send({ type: "closeAddBlockSidebar" })}
        >
          <ArrowLeft className="text-muted-foreground" />
          Add new block
        </Button>
      </div>
      <PanelContent className="flex grow basis-0 flex-col overflow-auto px-2 py-2">
        <Command
          value={highlightedValue}
          onValueChange={handleValueChange}
          className="overflow-visible rounded-none! bg-transparent! p-0!"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              previewStore.send({ type: "closeAddBlockSidebar" });
            }
          }}
        >
          <CommandInput placeholder="Search blocks..." className="px-0 pt-0" autoFocus />
          <CommandList className="mt-2 max-h-full">
            <CommandEmpty>No blocks found.</CommandEmpty>
            <CommandGroup className="p-0">
              {availableBlocks
                .sort(
                  (a, b) => (totalCounts[b._internal.id] ?? 0) - (totalCounts[a._internal.id] ?? 0),
                )
                .map((block: Block) => (
                  <CommandItem
                    key={block._internal.id}
                    value={block._internal.title}
                    keywords={[block._internal.description ?? ""]}
                    hideCheck
                    onSelect={() => {
                      void handleAddBlock(block);
                    }}
                    className="group bg-card data-[selected=true]:border-primary data-[selected=true]:after:border-primary mb-3 flex flex-col items-stretch gap-0 overflow-hidden rounded-lg border p-0 after:pointer-events-none after:absolute after:inset-0 after:z-10 after:rounded-[inherit] last:mb-0 data-[selected=true]:after:border"
                  >
                    <BlockThumbnail block={block} />
                    <div className="border-border flex flex-col gap-1 border-t px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 leading-5 font-medium">
                          {block._internal.title}
                        </span>
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
      </PanelContent>
    </>
  );
};

export { AddBlockSidebar };
