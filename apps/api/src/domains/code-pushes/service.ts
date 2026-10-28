import { DRAFT_SEARCH_PARAM } from "@camox/api-contract/drafts";
import { generateUuidv7, projectIdSchema } from "@camox/api-contract/ids";
import { projectWebsiteUrl } from "@camox/api-contract/projects";
import { and, eq, isNull } from "drizzle-orm";
import { Effect, Exit } from "effect";
import { z } from "zod";

import { requireUser } from "../../authorization";
import { decodeInput, NotFoundError, PushRefusedError } from "../../lib/errors";
import { record } from "../../lib/journal";
import type { ServiceContext } from "../_shared/service-context";
import { deleteDraftCode } from "../code/drafts";
import { drafts } from "../drafts/schema";
import { findEndedDraft, startDraft } from "../drafts/service";
import { projectWithCodeOutsideCamox } from "../projects/code-access";
import type { BuildResult } from "../revisions/result";
import { destroySandbox } from "../revisions/sandbox";
import { parseBundle } from "./bundle";
import { checkPush, draftEnded, INVALID_BUNDLE } from "./checks";
import {
  buildPushedHead,
  type CheckedLanding,
  doesNotBuild,
  type Landing,
  landBuilt,
} from "./land";

// A member pushing commits from their own checkout onto a draft (ADR 0026). The push goes to
// the API, never to the repo: every check runs, the head's build included, before anything is
// written. An accepted push lands its commits as they are on the draft's branch, and its head
// as one revision, through the revision build path. A push to an open draft goes through its
// thread's build queue, after the agent's turn going, if any.

export const pushInput = z.object({
  projectUuid: projectIdSchema,
  /** The local branch pushed, which names a draft it opens. */
  branch: z.string().trim().min(1).max(200),
  /**
   * The open draft the push lands on, such as the one an earlier push from the branch opened,
   * or one the agent started. Without it, the push opens a draft.
   */
  draftId: z.string().min(1).optional(),
  /** The branch's commits since the ones it shares with `main` or the draft, as a Git bundle. */
  bundle: z.instanceof(Blob),
});

/** Where a push stands, as it streams to the CLI while the push goes. */
export type PushStep =
  /** Its commits are checked against `main` and the draft. */
  | "checking"
  /** It waits for the agent's turn going in the draft to end. */
  | "waiting"
  /** Its head builds. */
  | "building";

/** A push that landed: its draft, the head's build and the studio URL. */
export type Pushed = {
  /** The draft, whose branch in the project's repo its id names. */
  draftId: string;
  result: BuildResult;
  studioUrl: string;
};

/**
 * Pushes the bundle's commits onto a new draft named after the branch, or onto the open draft
 * `draftId` names, for a member of a project whose code can be worked on outside Camox. Returns
 * the draft, the head's build (its type errors included) and the draft's studio URL.
 * `progress` hears where the push stands. A refused push writes nothing.
 */
export const pushToDraft = Effect.fn("code.push")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof pushInput>,
  progress: (step: PushStep) => void = () => {},
) {
  const user = yield* requireUser(ctx);
  const input = yield* decodeInput(pushInput, rawInput);
  const project = yield* projectWithCodeOutsideCamox(ctx, user.id, input.projectUuid);
  progress("checking");
  const open = input.draftId ? yield* openDraft(ctx, project.id, input.draftId) : undefined;
  const bundle = parseBundle(
    new Uint8Array(yield* Effect.promise(() => input.bundle.arrayBuffer())),
  );
  if (!bundle) return yield* new PushRefusedError(INVALID_BUNDLE);
  const hasCode = open
    ? yield* Effect.promise(() => ctx.env.DRAFT_CODE.getByName(open.id).held())
    : false;
  const check = yield* Effect.promise(() =>
    checkPush(ctx.env, {
      repo: project.uuid,
      bundle,
      ...(open && hasCode && { draftBranch: open.id }),
    }),
  );
  if ("refused" in check) return yield* new PushRefusedError(check.refused);
  const landing: CheckedLanding = { repo: project.uuid, ...check.checked };

  const studio = (draftId: string): Pushed["studioUrl"] => {
    const url = new URL(projectWebsiteUrl(project));
    url.searchParams.set(DRAFT_SEARCH_PARAM, draftId);
    return url.toString();
  };
  // The thread entry of the push, once it landed on the draft `draftId`.
  const entry = (draftId: string) => ({
    identity: { projectId: project.id, draftId, ownerId: null },
    pusher: { id: user.id, name: user.name, image: user.image ?? null },
    subjects: landing.subjects,
  });

  if (open) {
    const threadId = yield* threadOf(ctx, open.id);
    // The thread's answer, as its RPC stub types it, is the landing it returns.
    const landed = (yield* Effect.promise(() =>
      ctx.env.THREAD.getByName(threadId).landPush({ ...landing, ...entry(open.id) }, () =>
        progress("waiting"),
      ),
    )) as Landing;
    if ("refused" in landed) return yield* new PushRefusedError(landed.refused);
    return {
      draftId: open.id,
      result: landed.result,
      studioUrl: studio(open.id),
    } satisfies Pushed;
  }

  // The draft's id names its sandbox, which builds the head before the draft exists.
  const draftId = generateUuidv7();
  progress("building");
  const built = yield* Effect.promise(() => buildPushedHead(ctx.env, draftId, landing.prepared));
  if (!built.ok) {
    yield* Effect.promise(() =>
      destroySandbox(ctx.env, draftId).catch((error: unknown) =>
        console.error("A refused push's sandbox wasn't destroyed", error),
      ),
    );
    return yield* new PushRefusedError(doesNotBuild(built.log));
  }

  const threadId = generateUuidv7();
  yield* startDraft(ctx.db, {
    id: draftId,
    projectId: project.id,
    createdBy: user.id,
    name: input.branch,
    threadId,
  });
  // A failure on Camox's side from here leaves no half-made draft: it goes, as if never opened.
  const opened = yield* Effect.exit(
    Effect.promise(async () => {
      const result = await landBuilt(ctx.env, draftId, landing, built);
      await ctx.env.THREAD.getByName(threadId).notePush({ ...entry(draftId), result });
      return result;
    }),
  );
  if (Exit.isFailure(opened)) {
    yield* discardDraft(ctx, { projectId: project.id, draftId, threadId });
    return yield* Effect.failCause(opened.cause);
  }
  return {
    draftId,
    result: opened.value,
    studioUrl: studio(draftId),
  } satisfies Pushed;
});

/**
 * The project's open draft `draftId`, which a push names: one that was published or deleted
 * refuses the push.
 */
const openDraft = Effect.fn("code.push.openDraft")(function* (
  ctx: ServiceContext,
  projectId: number,
  draftId: string,
) {
  const draft = yield* Effect.promise(() =>
    ctx.db
      .select({ id: drafts.id })
      .from(drafts)
      .where(and(eq(drafts.id, draftId), eq(drafts.projectId, projectId)))
      .get(),
  );
  if (draft) return draft;
  const ended = yield* findEndedDraft(ctx.db, projectId, draftId);
  if (ended) {
    return yield* new PushRefusedError(draftEnded(`was ${ended.outcome}`));
  }
  return yield* new NotFoundError({ message: "This project has no draft with that id." });
});

/** The id of the draft's thread, set aside now if nobody opened it yet, as opening it does. */
const threadOf = Effect.fn("code.push.threadOf")(function* (ctx: ServiceContext, draftId: string) {
  yield* Effect.promise(() =>
    ctx.db
      .update(drafts)
      .set({ threadId: generateUuidv7() })
      .where(and(eq(drafts.id, draftId), isNull(drafts.threadId))),
  );
  const row = yield* Effect.promise(() =>
    ctx.db.select({ threadId: drafts.threadId }).from(drafts).where(eq(drafts.id, draftId)).get(),
  );
  if (!row?.threadId) {
    return yield* new PushRefusedError(draftEnded("ended as you pushed"));
  }
  return row.threadId;
});

/**
 * Removes a draft a push was opening, which Camox failed to finish: its row, its code and its
 * thread, as if it never opened. Best effort: what can't be removed is only reported.
 */
const discardDraft = Effect.fn("code.push.discardDraft")(function* (
  ctx: ServiceContext,
  { projectId, draftId, threadId }: { projectId: number; draftId: string; threadId: string },
) {
  yield* Effect.promise(async () => {
    await ctx.env.THREAD.getByName(threadId)
      .end()
      .catch((error: unknown) => console.error("A discarded draft's thread didn't end", error));
    await ctx.db.delete(drafts).where(eq(drafts.id, draftId));
  });
  yield* deleteDraftCode(ctx, { projectId, draftId });
  yield* record(ctx.db, { kind: "drafts", projectId });
});
