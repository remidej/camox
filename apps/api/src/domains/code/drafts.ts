import { Effect } from "effect";

import type { ServiceContext } from "../_shared/service-context";

/**
 * Deletes a draft's branch and working copy as the draft ends, when it has code. The draft ended
 * either way, so this never fails: code it couldn't delete is only reported.
 */
export const discardCode = Effect.fn("discardCode")(function* (
  ctx: Pick<ServiceContext, "env">,
  draftId: string,
) {
  yield* Effect.promise(async () => {
    try {
      await ctx.env.DRAFT_CODE.getByName(draftId).discard();
    } catch (error) {
      console.error("A draft's code wasn't deleted as the draft ended", error);
    }
  });
});
