import {
  DRAFT_SEARCH_PARAM,
  LOOK_BLOCK_DEFINITION_PARAM,
  LOOK_CONTENT_PARAM,
  LOOK_DOCUMENT_PATH,
  LOOK_LOCALE_PARAM,
  LOOK_PATH_PARAM,
  LOOK_SETTINGS_PARAM,
  LOOK_TOKEN_COOKIE,
  UNPLACED_BLOCK_ID,
} from "@camox/api-contract/drafts";
import { projectWebsiteUrl } from "@camox/api-contract/projects";
import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";

import { createDb } from "../../db";
import { runService } from "../../lib/run-service";
import type { SpanFields } from "../../lib/timing";
import type { Bindings } from "../../types";
import { agentServiceContext } from "../_shared/service-context";
import { getUnplacedBlock } from "../blocks/service";
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

/**
 * The longest a target may have the browser wait, once its document is ready and settled, before
 * it captures: enough to see an animation at a later moment.
 */
export const LOOK_MAX_DELAY_MS = 5000;

/**
 * The longest a look document's URL may be, in characters, which a Block Definition's overrides
 * travel in: well under what the website's host and the browser accept.
 */
export const LOOK_MAX_URL_LENGTH = 8000;

/**
 * A Block Definition, unplaced: its default content and Block Settings with overrides merged on,
 * in the shape the content tools take.
 */
export type BlockDefinitionTarget = {
  blockDefinition: string;
  content?: unknown;
  settings?: unknown;
};

/** One Placement on a page of the draft, by the page's path and the block's ID. */
export type PlacementTarget = PageTarget & { block: string };

/**
 * What the agent asks `look` to capture, with the sizes it wants and how long to wait before
 * capturing, in milliseconds.
 */
export type LookTarget = (PageTarget | PlacementTarget | BlockDefinitionTarget) & {
  sizes?: LookSize[];
  delay?: number;
};

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
          [
            target,
            delayRefused(target) ?? (await resolve(env, where, project.uuid, origin, target)),
          ] as const,
      ),
    ),
  );
  const toCapture = asked.flatMap(({ target, size }) => {
    const found = resolved.get(target)!;
    return "error" in found ? [] : [{ ...found, size, delayMs: target.delay }];
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

/** Why the delay `target` asks for is refused, failing that target, or undefined when it's fine. */
function delayRefused({ delay }: LookTarget): { error: string } | undefined {
  if (delay === undefined || (delay >= 0 && delay <= LOOK_MAX_DELAY_MS)) return undefined;
  return {
    error: `A delay is at most ${LOOK_MAX_DELAY_MS} milliseconds, and this one is ${delay}.`,
  };
}

/**
 * What `target` is captured as: the lightweight document of its page, once it's in the draft,
 * and for a Placement, its block's element there; or of its Block Definition's block, once the
 * draft has the definition and its schemas accept the overrides.
 */
async function resolve(
  env: Bindings,
  where: LookIn,
  projectUuid: string,
  origin: string,
  target: LookTarget,
): Promise<Resolved> {
  const url = new URL(LOOK_DOCUMENT_PATH, origin);
  url.searchParams.set(DRAFT_SEARCH_PARAM, where.draftId);
  if ("blockDefinition" in target) {
    url.searchParams.set(LOOK_BLOCK_DEFINITION_PARAM, target.blockDefinition);
    if (target.content !== undefined)
      url.searchParams.set(LOOK_CONTENT_PARAM, JSON.stringify(target.content));
    if (target.settings !== undefined)
      url.searchParams.set(LOOK_SETTINGS_PARAM, JSON.stringify(target.settings));
    if (url.href.length > LOOK_MAX_URL_LENGTH) {
      return {
        error:
          `The overrides are too long to look at: they travel in the page's address, at most ` +
          `${LOOK_MAX_URL_LENGTH} characters, and this one is ${url.href.length}. Shorten the ` +
          "overrides, such as long text, and look again.",
      };
    }
    const refused = await blockRefused(env, where, projectUuid, target);
    if (refused) return { error: refused };
    return { url: url.href, element: `[data-camox-viewport-block="${UNPLACED_BLOCK_ID}"]` };
  }
  const structure = await pageStructure(env, where, projectUuid, target);
  if ("error" in structure) return structure;
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

/** A service context reading the draft as the browser will, with the draft's look token. */
const lookContext = (env: Bindings, where: LookIn, locale?: string) => ({
  ...agentServiceContext({
    db: createDb(env.DB),
    env,
    user: null,
    waitUntil: (promise) => void promise.catch(console.error),
    draftId: where.draftId,
  }),
  look: { projectId: where.projectId, draftId: where.draftId },
  locale,
});

/** The message of an API error, or the error itself when it isn't one: a bug, which throws. */
function messageOf(error: unknown) {
  if (!(error instanceof ORPCError)) throw error;
  return error.message;
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
  try {
    return await runService(
      getPageStructure(lookContext(env, where, locale), { projectUuid, path }),
    );
  } catch (error) {
    const message = messageOf(error);
    return {
      error:
        (error as ORPCError<string, unknown>).code === "NOT_FOUND"
          ? `The draft has no page at ${path}${locale ? ` in ${locale}` : ""}.`
          : message,
    };
  }
}

/**
 * Why the Block Definition `target` names can't be looked at with its overrides, or undefined when
 * it can: the draft has no such definition, or its Content Schema or Settings Schema refuses an
 * override. Read as the browser will, with the draft's look token.
 */
async function blockRefused(
  env: Bindings,
  where: LookIn,
  projectUuid: string,
  { blockDefinition, content, settings }: BlockDefinitionTarget,
) {
  try {
    await runService(
      getUnplacedBlock(lookContext(env, where), {
        projectUuid,
        type: blockDefinition,
        content,
        settings,
      }),
    );
    return undefined;
  } catch (error) {
    return messageOf(error);
  }
}
