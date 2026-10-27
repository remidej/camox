import { DRAFT_SEARCH_PARAM } from "@camox/api-contract/drafts";
import { generateUuidv7, projectIdSchema } from "@camox/api-contract/ids";
import { projectWebsiteUrl } from "@camox/api-contract/projects";
import { Effect } from "effect";
import { z } from "zod";

import { requireUser } from "../../authorization";
import { decodeInput, PushRefusedError } from "../../lib/errors";
import type { ServiceContext } from "../_shared/service-context";
import { startDraft } from "../drafts/service";
import { projectWithCodeOutsideCamox } from "../projects/code-access";
import { buildRevision, failedBuild, retried } from "../revisions/build";
import { buildInSandbox, destroySandbox } from "../revisions/sandbox";
import { parseBundle } from "./bundle";
import { checkPush } from "./checks";

// A member pushing commits from their own checkout onto a draft (ADR 0026). The push goes to
// the API, never to the repo: every check runs, the head's build included, before anything is
// written. An accepted push lands its commits as they are on the draft's branch, and its head
// as one revision, through the revision build path.

export const pushInput = z.object({
  projectUuid: projectIdSchema,
  /** The local branch pushed, which names a draft it opens. */
  branch: z.string().trim().min(1).max(200),
  /** The branch's commits since the ones it shares with `main`, as a Git bundle. */
  bundle: z.instanceof(Blob),
});

/**
 * Pushes the bundle's commits onto a new draft named after the branch, for a member of a project
 * whose code can be worked on outside Camox. Returns the draft, its branch, the head's build
 * (its type errors included) and the draft's studio URL. A refused push writes nothing.
 */
export const pushToDraft = Effect.fn("code.push")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof pushInput>,
) {
  const user = yield* requireUser(ctx);
  const input = yield* decodeInput(pushInput, rawInput);
  const project = yield* projectWithCodeOutsideCamox(ctx, user.id, input.projectUuid);
  const bundle = parseBundle(
    new Uint8Array(yield* Effect.promise(() => input.bundle.arrayBuffer())),
  );
  if (!bundle) {
    return yield* new PushRefusedError({
      reason: "invalidBundle",
      message: "Camox expects a Git bundle of one branch's new commits.",
    });
  }
  const check = yield* Effect.promise(() => checkPush(ctx.env, { repo: project.uuid, bundle }));
  if ("refused" in check) return yield* new PushRefusedError(check.refused);
  const { prepared, prerequisites, base, pack } = check.checked;

  // The draft's id names its sandbox, which builds the head before the draft exists.
  const draftId = generateUuidv7();
  const built = yield* Effect.promise(() =>
    retried(() => buildInSandbox(ctx.env, draftId, prepared, { draftId, leftBy: "push" })),
  );
  if (!built.ok) {
    yield* Effect.promise(() =>
      destroySandbox(ctx.env, draftId).catch((error: unknown) =>
        console.error("A refused push's sandbox wasn't destroyed", error),
      ),
    );
    const { build, truncated } = failedBuild(built.log);
    return yield* new PushRefusedError({
      reason: "doesNotBuild",
      message: "Your branch's code doesn't build: fix its build errors, then push again.",
      data: { build, ...(truncated && { truncated }) },
    });
  }

  yield* startDraft(ctx.db, {
    id: draftId,
    projectId: project.id,
    createdBy: user.id,
    name: input.branch,
  });
  const result = yield* Effect.promise(async () => {
    const code = ctx.env.DRAFT_CODE.getByName(draftId);
    await retried(() => code.start({ repo: project.uuid, commit: base }));
    await retried(() => code.receive({ pack, prerequisites }));
    return buildRevision(ctx.env, draftId, { leftBy: "push", prepared, built });
  });
  const studio = new URL(projectWebsiteUrl(project));
  studio.searchParams.set(DRAFT_SEARCH_PARAM, draftId);
  return {
    draftId,
    /** The draft's branch in the project's repo, named by its id. */
    branch: draftId,
    result,
    studioUrl: studio.toString(),
  };
});
