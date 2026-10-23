import { toast } from "@camox/ui/toaster";
import { type UseMutationOptions, useMutation } from "@tanstack/react-query";

import { type Project, projectMutations } from "@/lib/queries";

import { reads, useStudioCache } from "../../lib/studio-reads";

type ProjectMutations = typeof projectMutations;
type ProjectMutation = keyof ProjectMutations;
type VariablesOf<M extends ProjectMutation> = Parameters<
  NonNullable<ReturnType<ProjectMutations[M]>["mutationFn"]>
>[0];

/**
 * One of the project's mutations, as a Settings part saves with it: once it succeeds the studio
 * reads the project afresh, then `onSuccess` runs and a toast says `success`; a failure toasts the
 * API's message, or `failure` when it has none.
 */
export function useProjectMutation<M extends ProjectMutation>(
  project: Project,
  mutation: M,
  {
    success,
    failure,
    onSuccess,
  }: {
    success: string | ((variables: VariablesOf<M>) => string);
    failure: string;
    onSuccess?: (variables: VariablesOf<M>) => void;
  },
) {
  const studioCache = useStudioCache();
  const options = projectMutations[mutation]() as unknown as UseMutationOptions<
    unknown,
    Error,
    VariablesOf<M>
  >;
  return useMutation({
    ...options,
    onSuccess: async (_, variables) => {
      await studioCache.invalidate(reads.project({ projectUuid: project.uuid }));
      onSuccess?.(variables);
      toast.success(typeof success === "string" ? success : success(variables));
    },
    onError: (error) => {
      toast.error(error.message || failure);
    },
  });
}
