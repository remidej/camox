import { DRAFT_HEADER } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { call, Procedure, type AnyProcedure } from "@orpc/server";
import { env } from "cloudflare:workers";
import { and, eq, isNull } from "drizzle-orm";

import { createDb } from "../src/db";
import type { ServiceContext } from "../src/domains/_shared/service-context";
import { requireDraft, type BaseContext } from "../src/orpc";
import {
  blockDefinitions,
  collectionDefinitions,
  drafts,
  environments,
  layouts,
  member,
  organizationTable,
  projects,
  user,
} from "../src/schema";
import type { Bindings } from "../src/types";

const now = 1_700_000_000_000;

export async function createProjectFixture(suffix: string) {
  const db = createDb(env.DB);
  const memberId = `member-${suffix}`;
  const outsiderId = `outsider-${suffix}`;
  const organizationId = `org-${suffix}`;

  const [memberUser, outsiderUser] = await db
    .insert(user)
    .values([
      {
        id: memberId,
        name: "Member",
        email: `member-${suffix}@example.com`,
        emailVerified: true,
        createdAt: new Date(now),
        updatedAt: new Date(now),
      },
      {
        id: outsiderId,
        name: "Outsider",
        email: `outsider-${suffix}@example.com`,
        emailVerified: true,
        createdAt: new Date(now),
        updatedAt: new Date(now),
      },
    ])
    .returning();
  await db.insert(organizationTable).values({
    id: organizationId,
    name: "Test organization",
    slug: `org-${suffix}`,
    createdAt: new Date(now),
  });
  await db.insert(member).values({
    id: `membership-${suffix}`,
    organizationId,
    userId: memberId,
    role: "owner",
    createdAt: new Date(now),
  });

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
  const environment = await db
    .insert(environments)
    .values({
      projectId: project.id,
      name: "production",
      type: "production",
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  const layout = await db
    .insert(layouts)
    .values({
      projectId: project.id,
      environmentId: environment.id,
      layoutId: "default",
      contentUpdatedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  return { db, environment, layout, memberUser, outsiderUser, project };
}

export function createServiceContext(
  db: ReturnType<typeof createDb>,
  selectedUser: ServiceContext["user"],
): ServiceContext {
  return {
    db,
    user: selectedUser,
    env: env as unknown as Bindings,
    waitUntil: () => undefined,
    environmentName: "production",
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
 * `procedure` without the "Live is read-only" check, so a test can seed Live content through a
 * content write naming no draft, the way a release writes Live. Everything else (auth, input
 * validation, the handler) runs as usual. Prefer publishing a draft where publish checks allow.
 */
export function seedingLive<T extends AnyProcedure>(procedure: T): T {
  const definition = procedure["~orpc"];
  const at = definition.middlewares.indexOf(requireDraft as never);
  if (at === -1) return procedure;
  const shift = (index: number) => (index > at ? index - 1 : index);
  return new Procedure({
    ...definition,
    middlewares: definition.middlewares.filter((_, index) => index !== at),
    inputValidationIndex: shift(definition.inputValidationIndex),
    outputValidationIndex: shift(definition.outputValidationIndex),
  }) as T;
}

/** `call`, except that a content write naming no draft seeds Live (see `seedingLive`). */
export const callSeedingLive: typeof call = (procedure, input, ...rest) => {
  const [options] = rest;
  const context = (options as { context?: { headers?: Headers } } | undefined)?.context;
  const namesDraft = context?.headers?.has(DRAFT_HEADER) ?? false;
  return call(namesDraft ? procedure : seedingLive(procedure as AnyProcedure), input, ...rest);
};

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
