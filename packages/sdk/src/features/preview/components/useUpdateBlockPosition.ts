import { queryKeys } from "@camox/api-contract/query-keys";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { generateKeyBetween } from "fractional-indexing";

import { useLocation } from "@/features/navigation/navigation";
import { type BlockBundle, type PageStructure, blockMutations } from "@/lib/queries";

export function useUpdateBlockPosition() {
  const queryClient = useQueryClient();
  const { pathname } = useLocation();

  return useMutation({
    ...blockMutations.updatePosition(),
    onMutate: (variables) => {
      // Optimistic updates only touch the draft cache — edits never affect
      // the live snapshot. The 'live' source slot stays as-is and the
      // studio's Live preview keeps showing the published version.
      const pageQueryKey = queryKeys.pages.getByPath(pathname, "draft");
      const previousPage = queryClient.getQueryData<PageStructure>(pageQueryKey);
      if (!previousPage) return {};

      const newPosition = generateKeyBetween(
        variables.afterPosition ?? null,
        variables.beforePosition ?? null,
      );

      // Update the moved block's position in its individual cache
      const blockKey = queryKeys.blocks.get(variables.id, "draft");
      const prevBundle = queryClient.getQueryData<BlockBundle>(blockKey);
      if (prevBundle) {
        queryClient.setQueryData(blockKey, {
          ...prevBundle,
          block: { ...prevBundle.block, position: newPosition },
        });
      }

      // Re-derive blockIds ordering from all block positions
      const blockIds = previousPage.page.blockIds;
      const positions = new Map<number, string>();
      for (const id of blockIds) {
        if (id === variables.id) {
          positions.set(id, newPosition);
        } else {
          const bundle = queryClient.getQueryData<BlockBundle>(queryKeys.blocks.get(id, "draft"));
          if (bundle) positions.set(id, bundle.block.position);
        }
      }
      const sortedIds = [...blockIds].sort((a, b) => {
        const posA = positions.get(a) ?? "";
        const posB = positions.get(b) ?? "";
        return posA.localeCompare(posB);
      });

      queryClient.setQueryData<PageStructure>(pageQueryKey, {
        ...previousPage,
        page: { ...previousPage.page, blockIds: sortedIds },
      });

      void queryClient.cancelQueries({ queryKey: pageQueryKey });
      return { previousPage, prevBundle };
    },
    onError: (_error, variables, context) => {
      if (context?.previousPage) {
        queryClient.setQueryData(
          queryKeys.pages.getByPath(pathname, "draft"),
          context.previousPage,
        );
      }
      if (context?.prevBundle) {
        queryClient.setQueryData(queryKeys.blocks.get(variables.id, "draft"), context.prevBundle);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.pages.getByPath(pathname, "draft"),
      });
    },
  });
}
