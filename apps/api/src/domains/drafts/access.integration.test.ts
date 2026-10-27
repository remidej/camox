import { generateUuidv7 } from "@camox/api-contract/ids";
import { Effect, Exit, type Scope } from "effect";
import { describe, expect, it } from "vite-plus/test";

import {
  createProjectFixture,
  createServiceContext,
  seedLive,
  noArtifactFields,
} from "../../../test/fixtures";
import { journaled, type Journal } from "../../lib/journal";
import { runService } from "../../lib/run-service";
import {
  blocks,
  drafts,
  endedDrafts,
  files,
  member,
  pages,
  repeatableItems,
  user,
} from "../../schema";
import type { ServiceContext } from "../_shared/service-context";
import { accessTo, type AccessMode, type ContentRef } from "./access";
import * as overlay from "./overlay";
import { draftIn, type DraftRequest } from "./scope";

/** Runs content access alone, in a journal announcing nothing: these tests look at access. */
const alone = <A, E>(effect: Effect.Effect<A, E, Journal | Scope.Scope>) =>
  journaled(Effect.scoped(effect), () => Effect.void);

// The access matrix, once for every kind of reference: who may read and write what, in which
// draft, and how each refusal fails.

const now = 1_700_000_000_000;

async function fixture(suffix: string) {
  const base = await createProjectFixture(suffix);
  const { db, project, layout, memberUser, outsiderUser } = base;

  // A second member, whose draft the first may use too.
  const [colleague] = await db
    .insert(user)
    .values({
      id: `colleague-${suffix}`,
      name: "Colleague",
      email: `colleague-${suffix}@example.com`,
      emailVerified: true,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    })
    .returning();
  await db.insert(member).values({
    id: `membership-colleague-${suffix}`,
    organizationId: project.organizationId,
    userId: colleague.id,
    role: "member",
    createdAt: new Date(now),
  });
  const openDraft = async (projectId: number, createdBy = memberUser.id) =>
    (await db.insert(drafts).values({ projectId, createdBy, createdAt: now }).returning().get()).id;
  const draft = await openDraft(project.id);
  const colleaguesDraft = await openDraft(project.id, colleague.id);
  const other = await createProjectFixture(`${suffix}-other`);
  const otherProjectsDraft = await openDraft(other.project.id);
  const endedDraft = generateUuidv7();
  await db.insert(endedDrafts).values({
    id: endedDraft,
    projectId: project.id,
    outcome: "deleted",
    endedBy: memberUser.id,
    endedAt: now,
  });

  const page = await seedLive(db, pages, {
    projectId: project.id,
    layoutId: layout.layoutId,
    pathSegment: "",
    fullPath: "/",
    nickname: "Home",
    contentUpdatedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  const block = await seedLive(db, blocks, {
    projectId: project.id,
    pageId: page.id,
    type: "hero",
    content: {},
    position: "a0",
    createdAt: now,
    updatedAt: now,
  });
  const item = await seedLive(db, repeatableItems, {
    blockId: block.id,
    fieldName: "links",
    content: {},
    position: "a0",
    createdAt: now,
    updatedAt: now,
  });
  const file = await seedLive(db, files, {
    projectId: project.id,
    url: "https://example.com/a.png",
    mimeType: "image/png",
    size: 1,
    blobId: "blob",
    path: "blob",
    createdAt: now,
    updatedAt: now,
  });

  const refs: Record<string, ContentRef> = {
    project: { project: project.id },
    projectUuid: { projectUuid: project.uuid },
    page: { page: page.id },
    block: { block: block.id },
    item: { item: item.id },
    file: { file: file.id },
  };

  /** How `access` turns out: "ok" with the scope's draft id, or the error's tag. */
  const outcome = async (
    as: ServiceContext["user"],
    ref: ContentRef,
    mode: AccessMode,
    requested: DraftRequest | null = null,
  ) => {
    const ctx = { ...createServiceContext(db, as), draft: requested };
    const exit = await Effect.runPromiseExit(alone(accessTo(ctx, ref, mode)));
    if (Exit.isSuccess(exit)) return `ok:${draftIn(exit.value.scope)?.id ?? "live"}`;
    const failure = exit.cause.toString();
    return failure.match(/(\w+Error)/)?.[1] ?? failure;
  };

  return {
    ...base,
    colleaguesDraft,
    draft,
    otherProjectsDraft,
    endedDraft,
    page,
    block,
    item,
    file,
    refs,
    outcome,
    outsiderUser,
    memberUser,
  };
}

const kinds = ["project", "projectUuid", "page", "block", "item", "file"] as const;

describe("content access", () => {
  for (const kind of kinds) {
    describe(`to a ${kind}`, () => {
      it("lets anyone read Live, and members read a draft", async () => {
        const f = await fixture(`access-read-${kind}`);
        const ref = f.refs[kind];

        expect(await f.outcome(null, ref, "public")).toBe("ok:live");
        expect(await f.outcome(f.outsiderUser, ref, "public")).toBe("ok:live");
        expect(await f.outcome(f.memberUser, ref, "public", { id: f.draft, create: false })).toBe(
          `ok:${f.draft}`,
        );
      });

      it("refuses an anonymous caller naming a draft or needing a member, with 401", async () => {
        const f = await fixture(`access-anonymous-${kind}`);
        const ref = f.refs[kind];

        expect(await f.outcome(null, ref, "public", { id: f.draft, create: false })).toBe(
          "UnauthenticatedError",
        );
        expect(await f.outcome(null, ref, "member")).toBe("UnauthenticatedError");
        expect(await f.outcome(null, ref, "write", { id: f.draft, create: false })).toBe(
          "UnauthenticatedError",
        );
      });

      it("refuses an outsider naming a draft or needing a member, with 403", async () => {
        const f = await fixture(`access-outsider-${kind}`);
        const ref = f.refs[kind];

        expect(await f.outcome(f.outsiderUser, ref, "public", { id: f.draft, create: false })).toBe(
          "ForbiddenError",
        );
        expect(await f.outcome(f.outsiderUser, ref, "member")).toBe("ForbiddenError");
        expect(await f.outcome(f.outsiderUser, ref, "write", { id: f.draft, create: true })).toBe(
          "ForbiddenError",
        );
      });

      it("refuses another project's draft with 404, and an ended draft with its outcome", async () => {
        const f = await fixture(`access-other-draft-${kind}`);
        const ref = f.refs[kind];

        for (const create of [false, true]) {
          expect(
            await f.outcome(f.memberUser, ref, "write", { id: f.otherProjectsDraft, create }),
          ).toBe("NotFoundError");
          expect(await f.outcome(f.memberUser, ref, "write", { id: f.endedDraft, create })).toBe(
            "DraftEndedError",
          );
        }
      });

      it("opens a draft another member started to every member", async () => {
        const f = await fixture(`access-colleague-${kind}`);
        const ref = f.refs[kind];

        expect(
          await f.outcome(f.memberUser, ref, "write", { id: f.colleaguesDraft, create: false }),
        ).toBe(`ok:${f.colleaguesDraft}`);
      });

      it("reads another project's content as missing for a request bound to a project", async () => {
        const f = await fixture(`access-bound-${kind}`);
        const ctx = (projectId: number) => ({
          ...createServiceContext(f.db, f.outsiderUser),
          draft: null,
          projectId,
        });
        const outcomeIn = async (projectId: number) => {
          const exit = await Effect.runPromiseExit(
            alone(accessTo(ctx(projectId), f.refs[kind], "member")),
          );
          return Exit.isSuccess(exit)
            ? "ok"
            : (exit.cause.toString().match(/(\w+Error)/)?.[1] ?? "");
        };

        expect(await outcomeIn(f.project.id + 100_000)).toBe("NotFoundError");
        // Bound to its own project, the outsider is refused for not being a member.
        expect(await outcomeIn(f.project.id)).toBe("ForbiddenError");
      });

      it("keeps Live read-only: a write naming no draft fails", async () => {
        const f = await fixture(`access-live-${kind}`);

        expect(await f.outcome(f.memberUser, f.refs[kind], "write")).toBe("LiveReadOnlyError");
      });
    });
  }

  for (const kind of ["page", "block", "item", "file"] as const) {
    it(`finds no ${kind} that doesn't exist, without falling back to Live`, async () => {
      const f = await fixture(`access-missing-${kind}`);
      const missing = { [kind]: generateUuidv7() } as ContentRef;

      expect(await f.outcome(null, missing, "public")).toBe("NotFoundError");
      expect(await f.outcome(f.memberUser, missing, "write", { id: f.draft, create: false })).toBe(
        "NotFoundError",
      );
    });
  }

  it("finds an entity the draft created in that draft only, and none the draft deleted", async () => {
    const f = await fixture("access-draft-only");
    const scope = { id: f.draft, projectId: f.project.id };
    const created = (await runService(
      overlay.insert(
        f.db,
        scope,
        blocks,
        {
          projectId: f.project.id,
          pageId: f.page.id,
          type: "hero",
          content: {},
          position: "a1",
          createdAt: now,
          updatedAt: now,
        },
        noArtifactFields,
      ),
    ))!;
    await runService(overlay.remove(f.db, scope, blocks, f.block.id));
    const inDraft = { id: f.draft, create: false };

    expect(await f.outcome(f.memberUser, { block: created.id }, "write", inDraft)).toBe(
      `ok:${f.draft}`,
    );
    expect(await f.outcome(null, { block: created.id }, "public")).toBe("NotFoundError");
    expect(await f.outcome(f.memberUser, { block: f.block.id }, "write", inDraft)).toBe(
      "NotFoundError",
    );
    // The item of the deleted block has nothing left to belong to in the draft.
    expect(await f.outcome(f.memberUser, { item: f.item.id }, "write", inDraft)).toBe(
      "NotFoundError",
    );
    expect(await f.outcome(null, { block: f.block.id }, "public")).toBe("ok:live");
  });

  it("returns the entity as the scope sees it", async () => {
    const f = await fixture("access-entity");
    const scope = { id: f.draft, projectId: f.project.id };
    await runService(
      overlay.update(
        f.db,
        scope,
        repeatableItems,
        f.item.id,
        { content: { label: "Draft" } },
        noArtifactFields,
      ),
    );
    const ctx = {
      ...createServiceContext(f.db, f.memberUser),
      draft: { id: f.draft, create: false },
    };

    const result = await Effect.runPromise(alone(accessTo(ctx, { item: f.item.id }, "write")));

    expect(result.entity.item).toMatchObject({ id: f.item.id, content: { label: "Draft" } });
    expect(result.project.id).toBe(f.project.id);
    expect(result.user.id).toBe(f.memberUser.id);
  });
});
