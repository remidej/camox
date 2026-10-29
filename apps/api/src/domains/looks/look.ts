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
 * A Block Definition, unplaced: its default content and Block Settings with overrides merged on,
 * in the shape the content tools take.
 */
export type BlockDefinitionTarget = {
  blockDefinition: string;
  content?: unknown;
  settings?: unknown;
};

/** What the agent asks `look` to capture, with the sizes it wants. */
export type LookTarget = (PageTarget | BlockDefinitionTarget) & { sizes?: LookSize[] };

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
 * What `target` is captured as: the lightweight document of its page, once it's in the draft, or
 * of its Block Definition's block, once the draft has the definition and its schemas accept the
 * overrides.
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
    const refused = await blockRefused(env, where, projectUuid, target);
    if (refused) return { error: refused };
    url.searchParams.set(LOOK_BLOCK_DEFINITION_PARAM, target.blockDefinition);
    if (target.content !== undefined)
      url.searchParams.set(LOOK_CONTENT_PARAM, JSON.stringify(target.content));
    if (target.settings !== undefined)
      url.searchParams.set(LOOK_SETTINGS_PARAM, JSON.stringify(target.settings));
    return { url: url.href, element: `[data-camox-viewport-block="${UNPLACED_BLOCK_ID}"]` };
  }
  const missing = await pageMissing(env, where, projectUuid, target);
  if (missing) return { error: missing };
  url.searchParams.set(LOOK_PATH_PARAM, target.path);
  if (target.locale) url.searchParams.set(LOOK_LOCALE_PARAM, target.locale);
  return { url: url.href };
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
 * Why the page `target` names can't be looked at, or undefined when the draft has it: read as the
 * browser will, with the draft's look token.
 */
async function pageMissing(
  env: Bindings,
  where: LookIn,
  projectUuid: string,
  { path, locale }: PageTarget,
) {
  try {
    await runService(getPageStructure(lookContext(env, where, locale), { projectUuid, path }));
    return undefined;
  } catch (error) {
    const message = messageOf(error);
    return (error as ORPCError<string, unknown>).code === "NOT_FOUND"
      ? `The draft has no page at ${path}${locale ? ` in ${locale}` : ""}.`
      : message;
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
