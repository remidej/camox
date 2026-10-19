import { useMutation } from "@tanstack/react-query";
import { generateKeyBetween } from "fractional-indexing";

import { useProjectSlug } from "@/lib/auth";
import { blockMutations } from "@/lib/queries";
import { reads, useStudioCache } from "@/lib/studio-reads";
import { useLocalePath } from "@/lib/view-locale";

export function useUpdateBlockPosition() {
  const studioCache = useStudioCache();
  const projectSlug = useProjectSlug();
  const pathname = useLocalePath();

  return useMutation({
    ...blockMutations.updatePosition(),
    onMutate: (variables) => {
      const edit = studioCache.edit();
      const page = reads.pageStructure({ path: pathname, projectSlug });
      const previousPage = edit.get(page);
      if (!previousPage) return { edit };

      const newPosition = generateKeyBetween(
        variables.afterPosition ?? null,
        variables.beforePosition ?? null,
      );

      // Update the moved block's position in its own read
      const moved = reads.blockBundle(variables.id);
      const movedBundle = edit.get(moved);
      if (movedBundle) {
        edit.set(moved, { ...movedBundle, block: { ...movedBundle.block, position: newPosition } });
      }

      // Re-derive blockIds ordering from all block positions
      const blockIds = previousPage.page.blockIds;
      const positions = new Map<string, string>();
      for (const id of blockIds) {
        if (id === variables.id) {
          positions.set(id, newPosition);
        } else {
          const bundle = edit.get(reads.blockBundle(id));
          if (bundle) positions.set(id, bundle.block.position);
        }
      }
      const sortedIds = [...blockIds].sort((a, b) => {
        const posA = positions.get(a) ?? "";
        const posB = positions.get(b) ?? "";
        return posA.localeCompare(posB);
      });

      edit.set(page, { ...previousPage, page: { ...previousPage.page, blockIds: sortedIds } });
      return { edit };
    },
    onError: (_error, _variables, context) => context?.edit.rollback(),
    onSettled: (_data, _error, _variables, context) => context?.edit.settle(),
  });
}
