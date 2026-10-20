import { DRAFT_CREATE_HEADER, DRAFT_HEADER } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { call } from "@orpc/server";
import { env } from "cloudflare:workers";
import { and, eq, isNull } from "drizzle-orm";
import type { Effect } from "effect";

import { createDb } from "../src/db";
import type { ServiceContext } from "../src/domains/_shared/service-context";
import * as overlay from "../src/domains/drafts/overlay";
import type { ContentTable } from "../src/domains/drafts/overlay";
import { draftOf, RELEASE, type Draft, type DraftScope } from "../src/domains/drafts/scope";
import { insertInitialLocale } from "../src/domains/locales/service";
import type { ServiceError } from "../src/lib/errors";
import { runService, type ServiceRequirements } from "../src/lib/run-service";
import type { BaseContext } from "../src/orpc";
import { router } from "../src/router";
import {
  blockDefinitions,
  collectionDefinitions,
  drafts,
  layouts,
  member,
  organizationTable,
  projects,
  user,
} from "../src/schema";
import type { Bindings } from "../src/types";

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
  const scope = draftOf({ id, kind: "regular", projectId });
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
    .values({ projectId, kind: "regular", createdBy: userId, createdAt: Date.now() })
    .returning({ id: drafts.id })
    .get();
  return draft.id;
}

/**
 * Writes Live content as a release does, through the drafts overlay: for Live states publish
 * refuses, such as an empty required reference, or Live changing under a draft to set up a
 * conflict.
 */
export async function seedLive<T extends ContentTable>(
  db: ReturnType<typeof createDb>,
  table: T,
  values: Parameters<typeof overlay.insert<T>>[3],
): Promise<T["$inferSelect"]> {
  const row = await runService(overlay.insert(db, RELEASE, table, values));
  if (!row) throw new Error("seedLive: Live already holds this entity");
  return row;
}

/**
 * A member's development draft holding a copy of Live's definitions, as if dev mode had synced
 * local code identical to the last release (ADR 0006). Returns the draft's id.
 */
export async function openDevelopmentDraft(
  db: ReturnType<typeof createDb>,
  projectId: number,
  userId: string,
) {
  const id = generateUuidv7();
  await db.insert(drafts).values({
    id,
    projectId,
    kind: "development",
    createdBy: userId,
    createdAt: now,
  });
  for (const table of [blockDefinitions, layouts, collectionDefinitions]) {
    const live = await db
      .select()
      .from(table)
      .where(and(eq(table.projectId, projectId), isNull(table.draftId)));
    for (const { rowId: _rowId, ...row } of live) {
      await db.insert(table).values({ ...row, draftId: id } as never);
    }
  }
  return id;
}
