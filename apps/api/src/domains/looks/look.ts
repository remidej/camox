import {
  DRAFT_SEARCH_PARAM,
  LOOK_DOCUMENT_PATH,
  LOOK_LOCALE_PARAM,
  LOOK_PATH_PARAM,
  LOOK_TOKEN_COOKIE,
} from "@camox/api-contract/drafts";
import { projectWebsiteUrl } from "@camox/api-contract/projects";
import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";

import { createDb } from "../../db";
import { runService } from "../../lib/run-service";
import type { SpanFields } from "../../lib/timing";
import type { Bindings } from "../../types";
import { agentServiceContext } from "../_shared/service-context";
import { signLookToken } from "../drafts/look-token";
import { getPageStructure } from "../pages/service";
import { projects } from "../projects/schema";
import { previewsWorkingCopy } from "../revisions/end-of-turn";
import type { Capture, Captured, Capturer, LookSize } from "./capture";

// What the agent's `look` does with a call's targets: refuses the call when the draft's preview
// is stale, checks each target, signs a look token, and has the browser capture every target at
// each of its sizes (ADR 0032).

/** How many images one `look` call returns at most, across its targets and sizes. */
export const LOOK_IMAGE_CAP = 8;

/** The sizes a target is captured at when it names none. */
export const DEFAULT_SIZES: readonly LookSize[] = ["desktop", "mobile"];

/** A page of the draft, by its path in its Locale, the Default Locale without one. */
export type PageTarget = { path: string; locale?: string };

/** One Placement on a page of the draft, by the page's path and the block's ID. */
export type PlacementTarget = PageTarget & { block: string };

/** What the agent asks `look` to capture, with the sizes it wants. */
export type LookTarget = (PageTarget | PlacementTarget) & { sizes?: LookSize[] };

/** One result: a target at one size, with its image, or why it failed. */
export type Looked = { target: LookTarget; size: LookSize } & Captured;

/** Where a `look` runs: the thread's draft, with what its spans are logged with. */
export type LookIn = {
  projectId: number;
  draftId: string;
  draftHasCode: boolean;
  span: SpanFields;
};

/** What a target is captured as, its sizes aside, or why the whole target fails. */
type Resolved = Omit<Capture, "size"> | { error: string };

/**
 * Captures `targets` in the draft `where` names with `capturer`, one result per target and size,
 * in order. A target fails alone; the whole call fails, throwing an error the agent can act on,
 * when it asks for too many images, when the draft's code changed since its preview, or when the
 * browser can't be reached.
 */
export async function look(
  env: Bindings,
  where: LookIn,
  targets: LookTarget[],
  capturer: Capturer,
): Promise<Looked[]> {
  const asked = targets.flatMap((target) =>
    (target.sizes ?? DEFAULT_SIZES).map((size) => ({ target, size })),
  );
  if (asked.length > LOOK_IMAGE_CAP) {
    throw new Error(
      `A look returns at most ${LOOK_IMAGE_CAP} images, and this one asks for ${asked.length}: ` +
        "look at fewer targets or sizes at once.",
    );
  }
  // A draft whose code no agent changed renders with Live's code, which is always ready.
  if (where.draftHasCode && !(await previewsWorkingCopy(env, where.draftId, where.span))) {
    throw new Error(
      "The draft's preview doesn't show your latest code changes: they aren't built, or their " +
        "build didn't become the preview. Call `build`, fix what it reports, then look again.",
    );
  }
  const db = createDb(env.DB);
  const project = await db
    .select({ uuid: projects.uuid, slug: projects.slug, customDomain: projects.customDomain })
    .from(projects)
    .where(eq(projects.id, where.projectId))
    .get();
  if (!project) throw new Error("The website is gone.");
  const origin = projectWebsiteUrl(project);
  const resolved = new Map(
    await Promise.all(
      targets.map(
        async (target) =>
          [target, await resolve(env, where, project.uuid, origin, target)] as const,
      ),
    ),
  );
  const toCapture = asked.flatMap(({ target, size }) => {
    const found = resolved.get(target)!;
    return "error" in found ? [] : [{ ...found, size }];
  });
  const captured = toCapture.length
    ? await capturer.capture(
        {
          cookie: {
            name: LOOK_TOKEN_COOKIE,
            value: await signLookToken(env, {
              projectId: where.projectId,
              draftId: where.draftId,
            }),
            host: new URL(origin).hostname,
          },
          captures: toCapture,
        },
        where.span,
      )
    : [];
  let next = 0;
  return asked.map(({ target, size }) => {
    const found = resolved.get(target)!;
    return { target, size, ...("error" in found ? found : captured[next++]!) };
  });
}

/**
 * What `target` is captured as: the lightweight document of its page, once it's in the draft,
 * and for a Placement, its block's element there.
 */
async function resolve(
  env: Bindings,
  where: LookIn,
  projectUuid: string,
  origin: string,
  target: LookTarget,
): Promise<Resolved> {
  const structure = await pageStructure(env, where, projectUuid, target);
  if ("error" in structure) return structure;
  const url = new URL(LOOK_DOCUMENT_PATH, origin);
  url.searchParams.set(DRAFT_SEARCH_PARAM, where.draftId);
  url.searchParams.set(LOOK_PATH_PARAM, target.path);
  if (target.locale) url.searchParams.set(LOOK_LOCALE_PARAM, target.locale);
  if (!("block" in target)) return { url: url.href };
  const { page, layout } = structure;
  const placements = [
    ...(layout?.beforeBlockIds ?? []),
    ...page.blockIds,
    ...(layout?.afterBlockIds ?? []),
  ];
  if (!placements.includes(target.block)) {
    return { error: `The page at ${target.path} has no block ${target.block}.` };
  }
  // The site's block render marks each block's element with its Placement ID, Layout blocks too.
  return { url: url.href, element: `[data-camox-viewport-block="${target.block}"]` };
}

/**
 * The structure of the page `target` names, read as the browser will, with the draft's look
 * token, or why it can't be looked at.
 */
async function pageStructure(
  env: Bindings,
  where: LookIn,
  projectUuid: string,
  { path, locale }: PageTarget,
) {
  const ctx = {
    ...agentServiceContext({
      db: createDb(env.DB),
      env,
      user: null,
      waitUntil: (promise) => void promise.catch(console.error),
      draftId: where.draftId,
    }),
    look: { projectId: where.projectId, draftId: where.draftId },
    locale,
  };
  try {
    return await runService(getPageStructure(ctx, { projectUuid, path }));
  } catch (error) {
    if (!(error instanceof ORPCError)) throw error;
    return {
      error:
        error.code === "NOT_FOUND"
          ? `The draft has no page at ${path}${locale ? ` in ${locale}` : ""}.`
          : error.message,
    };
  }
}
