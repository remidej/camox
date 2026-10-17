import { and, eq, inArray, isNull, or, type SQL, sql } from "drizzle-orm";
import { Effect, Exit, type Scope } from "effect";

import type { Database } from "../../db";
import {
  DraftEndedError,
  ForbiddenError,
  LiveReadOnlyError,
  NoDevelopmentDraftError,
  NotFoundError,
  type ServiceError,
  UnauthenticatedError,
} from "../../lib/errors";
import { blocks, files, member, pages, projects, repeatableItems } from "../../schema";
import type { ServiceContext } from "../_shared/service-context";
import * as overlay from "./overlay";
import { drafts } from "./schema";
import { draftOf, type Draft, type DraftScope } from "./scope";
import { dropIfEmpty, findEndedDraft, startDraft } from "./service";

// Content access (ADR 0011): turns a request into who is asking, the project it acts on, the
// draft scope it reads and writes, and the entity it names as that scope sees it. Every service
// acting on content starts here, so routes, AI tools and the CLI get the same checks.
//
// The checks run in a fixed order, and the first that fails wins:
// 1. 401: the request names a draft, or needs a member, and nobody is signed in.
// 2. 404: the entity, or the project, isn't in Live or in the named draft, or isn't in the
//    project the request is bound to (`ctx.projectId`).
// 3. 403: a member is needed (a draft is named, or the mode isn't `public`) and the caller isn't
//    one of the project's organization.
// 4. The named draft:
//    - `development`: the caller's development draft in the project, or NoDevelopmentDraftError.
//    - an id: created with the create header when missing; 404 when it isn't this project's, or
//      DraftEndedError when it was published or discarded. Someone else's development draft is
//      403.
// 5. 404: the scope deleted the entity.
// 6. LiveReadOnlyError: a `write` that names no draft.
//
// Access fails closed: nothing falls back to Live. A draft this request started is dropped again,
// while it stores nothing, when the service using the access fails: run services under
// `Effect.scoped`.

/** What a request names: an entity, or a project by id or slug. */
export type ContentRef =
  | { project: number }
  | { projectSlug: string }
  | { page: string }
  | { block: string }
  | { item: string }
  | { file: string };

type EntityRef = Exclude<ContentRef, { project: number } | { projectSlug: string }>;

/**
 * What a request may do: `public` reads Live for anyone and a draft for its project's members,
 * `member` reads for members only, and `write` changes content in a draft (Live is read-only).
 */
export type AccessMode = "public" | "member" | "write";

type Project = typeof projects.$inferSelect;
type User = NonNullable<ServiceContext["user"]>;
type PageRow = typeof pages.$inferSelect;
type BlockRow = typeof blocks.$inferSelect;
type ItemRow = typeof repeatableItems.$inferSelect;
type FileRow = typeof files.$inferSelect;

/** The entity a reference names, as the scope sees it. */
export type EntityOf<R extends ContentRef> = R extends { page: string }
  ? PageRow
  : R extends { block: string }
    ? { block: BlockRow; pagePath: string | null }
    : R extends { item: string }
      ? { item: ItemRow; pagePath: string | null }
      : R extends { file: string }
        ? FileRow
        : Project;

/** A request's access to content: what every content service acts with. */
export type ContentAccess<R extends ContentRef, M extends AccessMode> = {
  user: M extends "public" ? User | null : User;
  project: Project;
  scope: M extends "write" ? Draft : DraftScope;
  entity: EntityOf<R>;
};

type AccessContext = Pick<ServiceContext, "db" | "user" | "draft" | "projectId">;

/** One table's rows an entity id names: Live's, and the named draft's (any of the caller's development drafts). */
function storedForRequest(table: overlay.ContentTable, ctx: AccessContext): SQL {
  const requested = ctx.draft;
  if (!requested) return isNull(table.draftId);
  if (!("development" in requested)) return overlay.storedInLiveOrDraft(table, requested.id);
  const developmentDrafts = ctx.db
    .select({ id: drafts.id })
    .from(drafts)
    .where(and(eq(drafts.kind, "development"), eq(drafts.createdBy, ctx.user!.id)));
  return or(isNull(table.draftId), inArray(table.draftId, developmentDrafts))!;
}

/** An entity's rows in Live and in the named draft, with the project they belong to. */
type Candidates = { projectId: number; rows: (PageRow | BlockRow | ItemRow | FileRow)[] };

/**
 * The candidate rows of the entity a reference names, Live's and the named draft's, with the
 * project they belong to: one read, before the draft is known. Undefined when there are none.
 */
const locate = Effect.fn("access.locate")(function* (
  ctx: AccessContext,
  ref: EntityRef,
): Effect.fn.Return<Candidates | undefined> {
  const { db } = ctx;
  if ("item" in ref) {
    // An item's project is its block's, or the project of the shared content at its root.
    const rows = yield* Effect.promise(() =>
      db
        .select({
          item: repeatableItems,
          projectId: sql<
            number | null
          >`coalesce(${blocks.projectId}, ${repeatableItems.projectId})`,
        })
        .from(repeatableItems)
        .leftJoin(
          blocks,
          and(eq(blocks.id, repeatableItems.blockId), storedForRequest(blocks, ctx)),
        )
        .where(and(eq(repeatableItems.id, ref.item), storedForRequest(repeatableItems, ctx))),
    );
    const projectId = rows.find((row) => row.projectId != null)?.projectId;
    if (projectId == null) return undefined;
    // The join yields an item row per block row: keep one of each.
    const items = [...new Map(rows.map(({ item }) => [item.rowId, item])).values()];
    return { projectId, rows: items };
  }
  const [table, id] =
    "page" in ref ? [pages, ref.page] : "block" in ref ? [blocks, ref.block] : [files, ref.file];
  const rows = yield* Effect.promise(
    () =>
      db
        .select()
        .from(table)
        .where(and(eq(table.id, id), storedForRequest(table, ctx))) as Promise<
        (PageRow | BlockRow | FileRow)[]
      >,
  );
  const [first] = rows;
  if (!first?.projectId) return undefined;
  return { projectId: first.projectId, rows };
});

/** The row a scope reads among an entity's candidates: the draft's, else Live's; none when deleted. */
function visibleRow(rows: Candidates["rows"], scope: DraftScope) {
  const own = scope ? rows.find((row) => row.draftId === scope.id) : undefined;
  if (own) return own.deleted ? undefined : own;
  return rows.find((row) => row.draftId === null);
}

/**
 * The project with whether the caller is a member, and the draft the request names in it: one
 * read. A draft named by id is the row with that id, whichever project it belongs to.
 */
const authorize = Effect.fn("access.authorize")(function* (ctx: AccessContext, project: SQL) {
  const requested = ctx.draft;
  const userId = ctx.user?.id ?? null;
  const namedDraft =
    requested && "development" in requested
      ? and(
          eq(drafts.projectId, projects.id),
          eq(drafts.kind, "development"),
          eq(drafts.createdBy, userId ?? ""),
        )
      : eq(drafts.id, requested?.id ?? "");
  const row = yield* Effect.promise(() =>
    ctx.db
      .select({ project: projects, memberId: member.id, draft: drafts })
      .from(projects)
      .leftJoin(
        member,
        and(eq(member.organizationId, projects.organizationId), eq(member.userId, userId ?? "")),
      )
      .leftJoin(drafts, requested ? namedDraft : sql`0`)
      .where(project)
      .get(),
  );
  if (!row) return undefined;
  return { project: row.project, member: row.memberId != null, draft: row.draft };
});

/** Fails with the draft's outcome when it ended, and with 404 when it never existed. */
const missingDraft = Effect.fn("access.missingDraft")(function* (
  db: Database,
  projectId: number,
  draftId: string,
) {
  const ended = yield* findEndedDraft(db, projectId, draftId);
  if (ended) return yield* new DraftEndedError({ ended });
  return yield* new NotFoundError({
    message: `Draft ${draftId} not found in this project`,
    data: { draftId },
  });
});

/**
 * The scope the request names on a project, once the caller is known to be a member: Live, the
 * caller's development draft, or a regular draft, which the create header starts when missing.
 */
const resolveScope = Effect.fn("access.resolveScope")(function* (
  ctx: AccessContext & { user: User },
  project: Project,
  named: typeof drafts.$inferSelect | null,
): Effect.fn.Return<{ scope: DraftScope; started: boolean }, ServiceError> {
  const requested = ctx.draft;
  if (!requested) return { scope: null, started: false };
  if ("development" in requested) {
    if (!named) return yield* new NoDevelopmentDraftError();
    return { scope: draftOf(named), started: false };
  }
  let draft = named;
  let started = false;
  if (!draft && requested.create) {
    started = yield* startDraft(ctx.db, {
      id: requested.id,
      projectId: project.id,
      createdBy: ctx.user.id,
      name: null,
    });
    draft =
      (yield* Effect.promise(() =>
        ctx.db.select().from(drafts).where(eq(drafts.id, requested.id)).get(),
      )) ?? null;
  }
  if (draft?.projectId !== project.id) return yield* missingDraft(ctx.db, project.id, requested.id);
  // Regular drafts are open to every member; a development draft only to its owner (ADR 0011).
  if (draft.kind === "development" && draft.createdBy !== ctx.user.id) {
    return yield* new ForbiddenError({ message: "A development draft is open to its owner only" });
  }
  return { scope: draftOf(draft), started };
});

/**
 * The scope a member's request names. A draft the request started is dropped again, while it
 * stores nothing, when the scope closes on a failure.
 */
const memberScope = Effect.fn("access.memberScope")(function* (
  ctx: AccessContext & { user: User },
  project: Project,
  named: typeof drafts.$inferSelect | null,
) {
  const { scope, started } = yield* resolveScope(ctx, project, named);
  if (!started || !scope) return scope;
  yield* Effect.addFinalizer((exit) =>
    Exit.isFailure(exit) ? dropIfEmpty(ctx.db, scope) : Effect.void,
  );
  return scope;
});

/** A block's or item's page path as the scope reads it, for the invalidations writes send. */
const pagePathOf = Effect.fn("access.pagePathOf")(function* (
  db: Database,
  scope: DraftScope,
  pageId: string | null,
) {
  if (!pageId) return null;
  return (yield* overlay.get(db, scope, pages, pageId))?.fullPath ?? null;
});

/**
 * The entity a reference names as the scope reads it, from its candidates. An item names its
 * page through its block.
 */
const entityIn = Effect.fn("access.entityIn")(function* (
  db: Database,
  ref: ContentRef,
  located: Candidates | undefined,
  project: Project,
  scope: DraftScope,
) {
  if (!located) return project;
  const row = visibleRow(located.rows, scope);
  if (!row) return undefined;
  if ("block" in ref) {
    const block = row as BlockRow;
    return { block, pagePath: yield* pagePathOf(db, scope, block.pageId) };
  }
  if ("item" in ref) {
    const item = row as ItemRow;
    const block = item.blockId ? yield* overlay.get(db, scope, blocks, item.blockId) : undefined;
    // An item whose block the scope doesn't read has nothing to belong to.
    if (item.blockId && !block) return undefined;
    return { item, pagePath: yield* pagePathOf(db, scope, block?.pageId ?? null) };
  }
  return row;
});

/**
 * A request's access to the content `ref` names, in `mode`. Run the service using it under
 * `Effect.scoped`: a draft this request started is dropped again if the service fails.
 */
export const accessTo = <R extends ContentRef, M extends AccessMode>(
  ctx: AccessContext,
  ref: R,
  mode: M,
): Effect.Effect<ContentAccess<R, M>, ServiceError, Scope.Scope> =>
  Effect.gen(function* () {
    const { user } = ctx;
    // Live is public; naming a draft, or reading as a member, needs one.
    const needsMember = ctx.draft !== null || mode !== "public";
    if (!user && needsMember) return yield* new UnauthenticatedError();
    // A project is read with the membership check; an entity is located first, for its project.
    let located: Candidates | undefined;
    let where: SQL;
    if ("project" in ref) where = eq(projects.id, ref.project);
    else if ("projectSlug" in ref) where = eq(projects.slug, ref.projectSlug);
    else {
      located = yield* locate(ctx, ref);
      if (!located) return yield* new NotFoundError();
      where = eq(projects.id, located.projectId);
    }
    const authorized = yield* authorize(ctx, where);
    if (!authorized) return yield* new NotFoundError();
    if (ctx.projectId !== undefined && authorized.project.id !== ctx.projectId) {
      return yield* new NotFoundError();
    }
    const { project } = authorized;

    if (needsMember && !authorized.member) return yield* new ForbiddenError();
    const scope = needsMember
      ? yield* memberScope({ ...ctx, user: user! }, project, authorized.draft)
      : null;

    const entity = yield* entityIn(ctx.db, ref, located, project, scope);
    if (!entity) return yield* new NotFoundError();
    if (mode === "write" && !scope) return yield* new LiveReadOnlyError();
    return { user, project, scope, entity } as ContentAccess<R, M>;
  });
