import { DRAFT_CREATE_HEADER, DRAFT_HEADER } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { call } from "@orpc/server";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import type { Effect } from "effect";
import type { z } from "zod";

import { createDb } from "../src/db";
import type { ServiceContext } from "../src/domains/_shared/service-context";
import type { definitionSetInput } from "../src/domains/definitions/service";
import * as overlay from "../src/domains/drafts/overlay";
import type { ContentTable } from "../src/domains/drafts/overlay";
import { draftOf, RELEASE, type Draft, type DraftScope } from "../src/domains/drafts/scope";
import { insertInitialLocale } from "../src/domains/locales/service";
import { isTranslationJob } from "../src/lib/ai-job-queue";
import { runAiJob } from "../src/lib/ai-jobs";
import type { ServiceError } from "../src/lib/errors";
import { runService, type ServiceRequirements } from "../src/lib/run-service";
import type { BaseContext } from "../src/orpc";
import { router } from "../src/router";
import { drafts, layouts, member, organizationTable, projects, session, user } from "../src/schema";
import type { Bindings } from "../src/types";
import {
  draftsWithScheduledChecks,
  forgetScheduled,
  forgetScheduledChecks,
  scheduled,
  scheduledChecks,
} from "./generation";

const now = 1_700_000_000_000;

const testBindings = env as unknown as Bindings;

export async function createProjectFixture(suffix: string) {
  const db = createDb(env.DB);
  const memberId = `member-${suffix}`;
  const outsiderId = `outsider-${suffix}`;
  const organizationId = `org-${suffix}`;

  const [memberUser, outsiderUser] = await db
    .insert(user)
    .values([testUser(memberId, "Member"), testUser(outsiderId, "Outsider")])
    .returning();
  await db.insert(organizationTable).values({
    id: organizationId,
    name: "Test organization",
    slug: `org-${suffix}`,
    createdAt: new Date(now),
  });
  await db.insert(member).values(membership(organizationId, memberId, "owner"));

  const project = await db
    .insert(projects)
    .values({
      slug: `project-${suffix}`,
      name: "Test project",
      deployToken: "test-deploy-token",
      organizationId,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  await insertInitialLocale(db, project.id, now);
  const layout = await db
    .insert(layouts)
    .values({
      projectId: project.id,
      layoutId: "default",
      contentUpdatedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  return { db, layout, memberUser, outsiderUser, project };
}

const testUser = (id: string, name: string) => ({
  id,
  name,
  email: `${id}@example.com`,
  emailVerified: true,
  createdAt: new Date(now),
  updatedAt: new Date(now),
});

const membership = (organizationId: string, userId: string, role: "owner" | "member") => ({
  id: `membership-${userId}`,
  organizationId,
  userId,
  role,
  createdAt: new Date(now),
});

/** Signs `userId` in, as the dashboard's sign-in does, returning the session's token. */
export async function createSessionFixture(
  userId: string,
  { activeOrganizationId }: { activeOrganizationId?: string } = {},
) {
  const token = `session-${crypto.randomUUID()}`;
  const signedInAt = new Date();
  await createDb(env.DB)
    .insert(session)
    .values({
      id: `session-id-${token}`,
      token,
      userId,
      activeOrganizationId,
      expiresAt: new Date(signedInAt.getTime() + 60 * 60_000),
      createdAt: signedInAt,
      updatedAt: signedInAt,
    });
  return token;
}

/** Adds another member to an organization, as a teammate of the fixture's member. */
export async function addMember(db: ReturnType<typeof createDb>, organizationId: string) {
  const teammate = await db
    .insert(user)
    .values(testUser(`teammate-${crypto.randomUUID()}`, "Teammate"))
    .returning()
    .get();
  await db.insert(member).values(membership(organizationId, teammate.id, "member"));
  return teammate;
}

export function createServiceContext(
  db: ReturnType<typeof createDb>,
  selectedUser: ServiceContext["user"],
): ServiceContext {
  return {
    db,
    user: selectedUser,
    env: testBindings,
    waitUntil: () => undefined,
    client: "test",
    telemetryDisabled: true,
    draft: null,
  };
}

/**
 * An oRPC context for `call()`, signed in as `selectedUser` (anonymous when null). Pass draft
 * headers (`x-camox-draft`, `x-camox-draft-create`) so the real middleware resolves them; it
 * also works as a `ServiceContext`, which reads Live.
 */
export function createRpcContext(
  db: ReturnType<typeof createDb>,
  selectedUser: ServiceContext["user"],
  headers: Record<string, string> = {},
): BaseContext & ServiceContext {
  return {
    ...createServiceContext(db, selectedUser),
    headers: new Headers(headers),
    session: selectedUser && {
      id: `session-${selectedUser.id}`,
      token: "test",
      userId: selectedUser.id,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };
}

/**
 * A context naming `scope` the way a request does (`x-camox-draft`): services resolve it through
 * content access, with its checks. `null` names Live.
 */
export function inScope<C extends ServiceContext>(ctx: C, scope: DraftScope): C {
  return { ...ctx, draft: scope ? { id: scope.id, create: false } : null };
}

/**
 * Publishes a draft through the publish procedure, as its creator: the way content reaches Live.
 * Fails on blockers, like a real publish.
 */
async function publishThrowaway(db: ReturnType<typeof createDb>, draftId: string) {
  const draft = await db.select().from(drafts).where(eq(drafts.id, draftId)).get();
  // Nothing was written, so nothing was started.
  if (!draft) return;
  const creator = await db.select().from(user).where(eq(user.id, draft.createdBy)).get();
  const context = createRpcContext(db, creator!, { [DRAFT_HEADER]: draftId });
  const input = { projectId: draft.projectId };
  const { token } = await call(router.drafts.previewPublish, input, { context });
  await runChecks(db, draftId);
  await call(router.drafts.publish, { ...input, token }, { context });
}

/**
 * `call`, except that a content write naming no draft seeds Live: it runs in a throwaway draft,
 * which is then published (ADR 0009). Where publish refuses the Live state a test needs, such as
 * an empty required reference, use `seedLive` instead.
 */
export const callSeedingLive: typeof call = async (procedure, input, ...rest) => {
  const [options] = rest;
  const context = (options as { context?: BaseContext } | undefined)?.context;
  if (!context || context.headers.has(DRAFT_HEADER)) return call(procedure, input, ...rest);
  const draftId = generateUuidv7();
  const headers = new Headers(context.headers);
  headers.set(DRAFT_HEADER, draftId);
  headers.set(DRAFT_CREATE_HEADER, "1");
  // The options are the caller's, with the context naming the throwaway draft.
  const inDraft = { ...options, context: { ...context, headers } };
  const result = await call(procedure, input, ...([inDraft] as unknown as typeof rest));
  await publishThrowaway(context.db, draftId);
  return result;
};

/**
 * Runs content writes in a throwaway draft of `projectId`, created by the context's user, and
 * publishes it: seeds Live the way content reaches it (ADR 0009). `run` gets the draft, and the
 * context naming it for services that read the request's draft.
 */
export async function seedLiveThrough<A>(
  ctx: ServiceContext,
  projectId: number,
  run: (
    draft: Draft,
    inDraft: ServiceContext,
  ) => Effect.Effect<A, ServiceError, ServiceRequirements>,
): Promise<A> {
  const id = await startDraft(ctx.db, projectId, ctx.user!.id);
  const scope = draftOf({ id, projectId });
  const result = await runService(run(scope, { ...ctx, draft: { id, create: false } }));
  await publishThrowaway(ctx.db, id);
  return result;
}

/** Starts a regular draft of `projectId` as `userId`. Returns the draft's id. */
export async function startDraft(
  db: ReturnType<typeof createDb>,
  projectId: number,
  userId: string,
) {
  const draft = await db
    .insert(drafts)
    .values({ projectId, createdBy: userId, createdAt: Date.now() })
    .returning({ id: drafts.id })
    .get();
  return draft.id;
}

/** A write's options for content whose schema has no artifact field, so it stores no source. */
export const noArtifactFields = { artifactSources: { schema: null } } as const;

/**
 * Writes Live content as a release does, through the drafts overlay: for Live states publish
 * refuses, such as an empty required reference, or Live changing under a draft to set up a
 * conflict. Seeded content stores no artifact source, unless `options` names its schema.
 */
export async function seedLive<T extends ContentTable>(
  db: ReturnType<typeof createDb>,
  table: T,
  values: overlay.Patch<T> & { id?: string },
  options: overlay.WriteOptions = {},
): Promise<T["$inferSelect"]> {
  const seeded = [{ artifactSources: "stored", ...options }] as overlay.WriteOptionsArgs<
    T,
    typeof values
  >;
  const row = await runService(overlay.insert(db, RELEASE, table, values, ...seeded));
  if (!row) throw new Error("seedLive: Live already holds this entity");
  return row;
}

/** A Definition Set as a test writes it: each part it leaves out holds nothing. */
export type TestDefinitionSet = Partial<z.input<typeof definitionSetInput>>;

/**
 * Syncs a whole Definition Set through `definitions.sync`, the way the website's code reaches the
 * API: a release to Live with the project's deploy token (ADR 0006). A set declaring no layouts
 * leaves Live's layouts, like the fixture's `default` one, as they are.
 */
export function syncDefinitionSet(
  db: ReturnType<typeof createDb>,
  project: { uuid: string; deployToken: string | null },
  set: TestDefinitionSet,
) {
  const definitionSet = {
    blocks: set.blocks ?? [],
    layouts: set.layouts ?? [],
    collections: set.collections ?? [],
    homepage: set.homepage ?? null,
  };
  return call(
    router.definitions.sync,
    { projectUuid: project.uuid, deployToken: project.deployToken ?? "", definitionSet },
    { context: createRpcContext(db, null) },
  );
}

/**
 * Runs every translation job scheduled so far, as their alarms would, and forgets them. With no
 * translation scripted, they settle having translated nothing: publishing waits for them.
 */
export async function runTranslations(db: ReturnType<typeof createDb>) {
  const jobs = scheduled().filter(isTranslationJob);
  forgetScheduled(...jobs.map((job) => job.entityId));
  const keyed = new Map(jobs.map((job) => [JSON.stringify({ ...job, delayMs: 0 }), job]));
  for (const job of keyed.values()) await runService(runAiJob(db, job));
  // A catch-up draft is published once its checks ran too (ADR 0033).
  await runAllChecks(db);
}

/**
 * Runs the patrollers' checks scheduled for a draft, as their alarms would, and forgets them:
 * those its review requested, which publishing waits for (ADR 0033).
 */
export async function runChecks(db: ReturnType<typeof createDb>, draftId: string) {
  const jobs = scheduledChecks(draftId);
  forgetScheduledChecks(draftId);
  for (const job of jobs) await runService(runAiJob(db, job));
}

/**
 * A draft's publish preview, `preview`, once the checks its review requested ran: what publishing
 * waits for (ADR 0033).
 */
export async function reviewed<P>(
  db: ReturnType<typeof createDb>,
  draftId: string,
  preview: Promise<P>,
): Promise<P> {
  const shown = await preview;
  await runChecks(db, draftId);
  return shown;
}

/**
 * Runs the patrollers' checks scheduled for every draft, as their alarms would, and forgets them,
 * until none is left: a catch-up draft Camox publishes once they ran.
 */
export async function runAllChecks(db: ReturnType<typeof createDb>) {
  for (let drafts = draftsWithScheduledChecks(); drafts.length > 0;) {
    for (const draftId of drafts) await runChecks(db, draftId);
    drafts = draftsWithScheduledChecks();
  }
}
