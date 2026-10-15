import { queryKeys } from "@camox/api-contract/query-keys";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { generateKeyBetween } from "fractional-indexing";

import { useLocation } from "@/features/navigation/navigation";
import { type BlockBundle, type PageStructure, blockMutations } from "@/lib/queries";

import { scopedKey } from "../../../lib/studio-draft";

export function useUpdateBlockPosition() {
  const queryClient = useQueryClient();
  const { pathname } = useLocation();

  return useMutation({
    ...blockMutations.updatePosition(),
    onMutate: (variables) => {
      const pageQueryKey = scopedKey(queryKeys.pages.getByPath(pathname));
      const previousPage = queryClient.getQueryData<PageStructure>(pageQueryKey);
      if (!previousPage) return {};

      const newPosition = generateKeyBetween(
        variables.afterPosition ?? null,
        variables.beforePosition ?? null,
      );

      // Update the moved block's position in its individual cache
      const blockKey = scopedKey(queryKeys.blocks.get(variables.id));
      const prevBundle = queryClient.getQueryData<BlockBundle>(blockKey);
      if (prevBundle) {
        queryClient.setQueryData(blockKey, {
          ...prevBundle,
          block: { ...prevBundle.block, position: newPosition },
        });
      }

      // Re-derive blockIds ordering from all block positions
      const blockIds = previousPage.page.blockIds;
      const positions = new Map<string, string>();
      for (const id of blockIds) {
        if (id === variables.id) {
          positions.set(id, newPosition);
        } else {
          const bundle = queryClient.getQueryData<BlockBundle>(scopedKey(queryKeys.blocks.get(id)));
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
          scopedKey(queryKeys.pages.getByPath(pathname)),
          context.previousPage,
        );
      }
      if (context?.prevBundle) {
        queryClient.setQueryData(scopedKey(queryKeys.blocks.get(variables.id)), context.prevBundle);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: scopedKey(queryKeys.pages.getByPath(pathname)),
      });
    },
  });
}
