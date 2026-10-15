import type { CommentTarget } from "@camox/api-contract";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { createProjectFixture, createServiceContext } from "../../../test/fixtures";
import { runService } from "../../lib/run-service";
import {
  blockDefinitions,
  blocks,
  comments,
  environments,
  layouts,
  pages,
  repeatableItems,
} from "../../schema";
import { callTool } from "../agent/service";
import { replicateEnvironment } from "../environments/service";
import { commentProcedures } from "./routes";
import { createComment, listComments, setCommentResolved } from "./service";

const { broadcastInvalidation } = vi.hoisted(() => {
  vi.resetModules();
  return { broadcastInvalidation: vi.fn() };
});
vi.mock("../../lib/broadcast-invalidation", () => ({ broadcastInvalidation }));

async function fixture() {
  const base = await createProjectFixture(crypto.randomUUID());
  const now = Date.now();
  const page = await base.db
    .insert(pages)
    .values({
      projectId: base.project.id,
      environmentId: base.environment.id,
      layoutId: base.layout.layoutId,
      pathSegment: "about",
      fullPath: "/about",
      nickname: "About",
      createdAt: now,
      updatedAt: now,
      contentUpdatedAt: now,
    })
    .returning()
    .get();
  await base.db.insert(blockDefinitions).values({
    projectId: base.project.id,
    environmentId: base.environment.id,
    blockId: "hero",
    title: "Hero",
    description: "",
    contentSchema: {
      properties: {
        title: { type: "string" },
        cards: {
          type: "array",
          items: {
            properties: {
              label: { type: "string" },
              children: { type: "array", items: { properties: { text: { type: "string" } } } },
            },
          },
        },
      },
    },
    createdAt: now,
    updatedAt: now,
  });
  const block = await base.db
    .insert(blocks)
    .values({
      environmentId: base.environment.id,
      pageId: page.id,
      type: "hero",
      content: {},
      position: "a0",
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  const item = await base.db
    .insert(repeatableItems)
    .values({
      blockId: block.id,
      fieldName: "cards",
      content: {},
      position: "a0",
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  const nested = await base.db
    .insert(repeatableItems)
    .values({
      blockId: block.id,
      parentItemId: item.id,
      fieldName: "children",
      content: {},
      position: "a0",
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  const ctx = createServiceContext(base.db, base.memberUser);
  const create = (target: CommentTarget, message = "Feedback") =>
    runService(createComment(ctx, { id: generateUuidv7(), pageId: page.id, message, target }));
  return { ...base, ctx, page, block, item, nested, create };
}

describe("comments", () => {
  it("persists resolve/reopen state and invalidates the page comments", async () => {
    const f = await fixture();
    const comment = await f.create({ kind: "block", blockId: f.block.id });
    expect(comment.resolved).toBe(false);
    const input = { pageId: f.page.id, id: comment.id, resolved: true };
    vi.mocked(broadcastInvalidation).mockClear();
    expect(await runService(setCommentResolved(f.ctx, input))).toEqual({
      ...comment,
      resolved: true,
    });
    expect(broadcastInvalidation).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: f.project.id,
        targets: [["camox", "comments", "list", f.page.id]],
      }),
    );
    expect(await runService(listComments(f.ctx, { pageId: f.page.id }))).toEqual([
      { ...comment, resolved: true },
    ]);
    expect(await runService(setCommentResolved(f.ctx, input))).toEqual({
      ...comment,
      resolved: true,
    });
    await f.db.delete(blocks).where(eq(blocks.id, f.block.id));
    expect(await runService(setCommentResolved(f.ctx, { ...input, resolved: false }))).toEqual({
      ...comment,
      target: null,
    });
    expect(await f.db.select().from(comments).where(eq(comments.id, comment.id))).toMatchObject([
      { resolved: false },
    ]);
  });

  it("rejects unauthorized, missing, wrong-page, and malformed resolution requests", async () => {
    const f = await fixture();
    const comment = await f.create({ kind: "page" });
    const input = { pageId: f.page.id, id: comment.id, resolved: true };
    vi.mocked(broadcastInvalidation).mockClear();
    for (const [ctx, code] of [
      [{ ...f.ctx, user: null }, "UNAUTHORIZED"],
      [{ ...f.ctx, user: f.outsiderUser }, "FORBIDDEN"],
      [{ ...f.ctx, environmentName: "other" }, "NOT_FOUND"],
    ] as const) {
      await expect(runService(setCommentResolved(ctx, input))).rejects.toMatchObject({ code });
    }
    const sibling = await f.db
      .insert(pages)
      .values({
        ...f.page,
        rowId: undefined,
        id: undefined,
        pathSegment: "sibling",
        fullPath: "/sibling",
      })
      .returning()
      .get();
    await expect(
      runService(setCommentResolved(f.ctx, { ...input, pageId: sibling.id })),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      runService(setCommentResolved(f.ctx, { ...input, id: generateUuidv7() })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    for (const invalid of [
      { ...input, id: "invalid" },
      { ...input, pageId: 0 },
      { ...input, resolved: "true" },
      { pageId: input.pageId, id: input.id },
      { ...input, authorId: f.memberUser.id },
    ]) {
      await expect(runService(setCommentResolved(f.ctx, invalid as never))).rejects.toThrow();
    }
    expect(broadcastInvalidation).not.toHaveBeenCalled();
    expect(await runService(listComments(f.ctx, { pageId: f.page.id }))).toEqual([comment]);
  });

  it("lists repeated nested targets with a fixed query budget", async () => {
    const f = await fixture();
    const layoutBlock = await f.db
      .insert(blocks)
      .values({
        ...f.block,
        rowId: undefined,
        id: undefined,
        pageId: null,
        layoutId: f.layout.layoutId,
      })
      .returning()
      .get();
    const targets: CommentTarget[] = [
      { kind: "item-field", blockId: f.block.id, itemId: f.nested.id, fieldName: "text" },
      { kind: "item-field", blockId: f.block.id, itemId: f.item.id, fieldName: "label" },
      { kind: "block-field", blockId: layoutBlock.id, fieldName: "title" },
    ];
    await f.create(targets[0]!);
    const prepare = vi.spyOn(f.ctx.env.DB, "prepare");
    try {
      expect(await runService(listComments(f.ctx, { pageId: f.page.id }))).toHaveLength(1);
      const singleCount = prepare.mock.calls.length;
      expect(singleCount).toBeLessThanOrEqual(7);
      for (let index = 0; index < 63; index++) {
        const target = targets[index % targets.length]!;
        await f.db.insert(comments).values({
          id: generateUuidv7(),
          pageId: f.page.id,
          environmentId: f.environment.id,
          authorId: f.memberUser.id,
          message: "Repeated feedback",
          target,
          blockId: "blockId" in target ? target.blockId : null,
          itemId: "itemId" in target ? target.itemId : null,
          createdAt: Date.now(),
        });
      }
      prepare.mockClear();
      const result = await runService(listComments(f.ctx, { pageId: f.page.id }));
      expect(result).toHaveLength(64);
      expect(result.every((comment) => comment.target !== null)).toBe(true);
      expect(prepare).toHaveBeenCalledTimes(singleCount);
    } finally {
      prepare.mockRestore();
    }
  });

  it("keeps layout feedback page scoped and broadcasts only once for concurrent retries", async () => {
    const f = await fixture();
    const sibling = await f.db
      .insert(pages)
      .values({
        ...f.page,
        rowId: undefined,
        id: undefined,
        pathSegment: "sibling",
        fullPath: "/sibling",
      })
      .returning()
      .get();
    const layoutBlock = await f.db
      .insert(blocks)
      .values({
        ...f.block,
        rowId: undefined,
        id: undefined,
        pageId: null,
        layoutId: f.layout.layoutId,
      })
      .returning()
      .get();
    const input = {
      id: generateUuidv7(),
      pageId: f.page.id,
      message: "Shared header",
      target: { kind: "block" as const, blockId: layoutBlock.id },
    };
    vi.mocked(broadcastInvalidation).mockClear();
    const results = await Promise.all([
      runService(createComment(f.ctx, input)),
      runService(createComment(f.ctx, input)),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(broadcastInvalidation).toHaveBeenCalledTimes(1);
    expect(broadcastInvalidation).toHaveBeenCalledWith(
      expect.objectContaining({
        targets: [["camox", "comments", "list", f.page.id]],
      }),
    );
    expect(await runService(listComments(f.ctx, { pageId: sibling.id }))).toEqual([]);
    await expect(
      runService(
        createComment(f.ctx, {
          ...input,
          id: generateUuidv7(),
          pageId: sibling.id,
          target: { kind: "block", blockId: f.block.id },
        }),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await f.db.delete(blocks).where(eq(blocks.id, layoutBlock.id));
    expect(await runService(createComment(f.ctx, input))).toMatchObject({
      id: input.id,
      target: null,
    });
  });

  it("creates all typed targets, supplies provenance, and retries idempotently", async () => {
    const f = await fixture();
    const targets: CommentTarget[] = [
      { kind: "page" },
      { kind: "block", blockId: f.block.id },
      { kind: "block-field", blockId: f.block.id, fieldName: "title" },
      { kind: "item", blockId: f.block.id, itemId: f.item.id },
      { kind: "item-field", blockId: f.block.id, itemId: f.item.id, fieldName: "label" },
      { kind: "item-field", blockId: f.block.id, itemId: f.nested.id, fieldName: "text" },
    ];
    for (const target of targets) {
      const input = { id: generateUuidv7(), pageId: f.page.id, message: " Feedback ", target };
      const first = await runService(createComment(f.ctx, input));
      expect(first).toMatchObject({
        message: "Feedback",
        resolved: false,
        target,
        author: { name: "Member", image: null },
        environmentId: f.environment.id,
        createdAt: expect.any(Number),
      });
      expect(await runService(createComment(f.ctx, input))).toEqual(first);
      await expect(
        runService(createComment(f.ctx, { ...input, message: "Changed" })),
      ).rejects.toMatchObject({
        code: "CONFLICT",
      });
    }
    expect(await runService(listComments(f.ctx, { pageId: f.page.id }))).toHaveLength(
      targets.length,
    );
  });

  it("rejects anonymous/nonmember/wrong-environment access and malformed/foreign targets", async () => {
    const f = await fixture();
    const other = await fixture();
    const input = {
      id: generateUuidv7(),
      pageId: f.page.id,
      message: "Feedback",
      target: { kind: "page" as const },
    };
    for (const [ctx, code] of [
      [{ ...f.ctx, user: null }, "UNAUTHORIZED"],
      [{ ...f.ctx, user: f.outsiderUser }, "FORBIDDEN"],
      [{ ...f.ctx, environmentName: "other" }, "NOT_FOUND"],
    ] as const) {
      await expect(runService(createComment(ctx, input))).rejects.toMatchObject({ code });
      await expect(runService(listComments(ctx, { pageId: f.page.id }))).rejects.toMatchObject({
        code,
      });
    }
    for (const target of [
      { kind: "block", blockId: other.block.id },
      { kind: "item", blockId: f.block.id, itemId: other.item.id },
      { kind: "block-field", blockId: f.block.id, fieldName: "missing" },
      { kind: "block-field", blockId: f.block.id, fieldName: " title " },
      { kind: "item-field", blockId: f.block.id, itemId: f.item.id, fieldName: "title" },
    ] satisfies CommentTarget[]) {
      await expect(f.create(target)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    await expect(runService(createComment(f.ctx, { ...input, id: "invalid" }))).rejects.toThrow();
    await expect(runService(createComment(f.ctx, { ...input, message: " " }))).rejects.toThrow();
    await expect(
      runService(createComment(f.ctx, { ...input, target: { kind: "page", x: 1 } } as never)),
    ).rejects.toThrow();
    await expect(
      runService(createComment(f.ctx, { ...input, authorId: f.outsiderUser.id } as never)),
    ).rejects.toThrow();
  });

  it("retains deleted targets as unavailable and cannot reattach a reused ID", async () => {
    const f = await fixture();
    await f.create({ kind: "item", blockId: f.block.id, itemId: f.item.id });
    // Deleting an item unanchors its comments, as the services do: items hold no foreign keys.
    await f.db.delete(repeatableItems).where(eq(repeatableItems.id, f.item.id));
    await f.db.update(comments).set({ itemId: null }).where(eq(comments.itemId, f.item.id));
    await f.db.insert(repeatableItems).values({ ...f.item, rowId: undefined });
    expect(await runService(listComments(f.ctx, { pageId: f.page.id }))).toMatchObject([
      { target: null },
    ]);
    await f.create({ kind: "block-field", blockId: f.block.id, fieldName: "title" });
    await f.db
      .update(blockDefinitions)
      .set({ contentSchema: { properties: {} } })
      .where(eq(blockDefinitions.environmentId, f.environment.id));
    expect(
      (await runService(listComments(f.ctx, { pageId: f.page.id }))).every(
        (c) => c.target === null,
      ),
    ).toBe(true);
  });

  it("replaces destination comments, remaps nested targets, preserves provenance and unavailable feedback", async () => {
    const f = await fixture();
    const now = Date.now();
    const destination = await f.db
      .insert(environments)
      .values({
        projectId: f.project.id,
        name: "staging",
        type: "development",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    const layout = await f.db
      .insert(layouts)
      .values({ ...f.layout, rowId: undefined, environmentId: destination.id })
      .returning()
      .get();
    const definition = await f.db
      .select()
      .from(blockDefinitions)
      .where(eq(blockDefinitions.environmentId, f.environment.id))
      .get();
    await f.db
      .insert(blockDefinitions)
      .values({ ...definition!, rowId: undefined, environmentId: destination.id });
    const page = await f.db
      .insert(pages)
      .values({
        ...f.page,
        rowId: undefined,
        id: undefined,
        environmentId: destination.id,
        layoutId: layout.layoutId,
      })
      .returning()
      .get();
    const old = await runService(
      createComment(
        { ...f.ctx, environmentName: destination.name },
        {
          id: generateUuidv7(),
          pageId: page.id,
          message: "Old destination",
          target: { kind: "page" },
        },
      ),
    );
    const original = await f.create({
      kind: "item-field",
      blockId: f.block.id,
      itemId: f.nested.id,
      fieldName: "text",
    });
    const unavailable = await f.create({ kind: "block", blockId: f.block.id });
    await runService(
      setCommentResolved(f.ctx, { pageId: f.page.id, id: original.id, resolved: true }),
    );
    // Delete a separate target without removing the nested target.
    const deleted = await f.db
      .insert(blocks)
      .values({ ...f.block, rowId: undefined, id: undefined })
      .returning()
      .get();
    await f.create({ kind: "block", blockId: deleted.id });
    await f.db.delete(blocks).where(eq(blocks.id, deleted.id));
    const result = await runService(
      replicateEnvironment(f.ctx, {
        projectId: f.project.id,
        sourceEnvName: "production",
        targetEnvName: destination.name,
      }),
    );
    expect(result.copied.comments).toBe(3);
    expect(await f.db.select().from(comments).where(eq(comments.id, old.id))).toEqual([]);
    const copied = await f.db
      .select()
      .from(comments)
      .where(eq(comments.environmentId, destination.id));
    expect(copied).toHaveLength(3);
    const nested = copied.find((c) => c.target?.kind === "item-field")!;
    expect(nested.id).not.toBe(original.id);
    expect(nested.pageId).not.toBe(f.page.id);
    expect(nested.blockId).not.toBe(f.block.id);
    expect(nested.itemId).not.toBe(f.nested.id);
    expect(nested.createdAt).toBe(original.createdAt);
    expect(nested.authorId).toBe(f.memberUser.id);
    expect(nested.resolved).toBe(true);
    expect(nested.target).toMatchObject({
      blockId: nested.blockId,
      itemId: nested.itemId,
      fieldName: "text",
    });
    expect(copied.filter((c) => c.target === null)).toHaveLength(1);
    expect(await f.db.select().from(comments).where(eq(comments.id, unavailable.id))).toHaveLength(
      1,
    );
  });
});

// Independent of the shared schema: version nibble 7, RFC 4122 variant.
const UUIDV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CLIENT_COMMENT_ID = "019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a7b";

describe("stable comment identity", () => {
  function procedureContext(f: Awaited<ReturnType<typeof fixture>>) {
    return {
      context: {
        ...f.ctx,
        headers: new Headers(),
        session: {
          id: "session",
          token: "test",
          userId: f.memberUser.id,
          expiresAt: new Date(Date.now() + 60_000),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
    };
  }

  it("creating a comment returns a UUIDv7, or keeps a client-minted UUIDv7", async () => {
    const f = await fixture();
    const options = procedureContext(f);
    const input = { pageId: f.page.id, message: "Feedback", target: { kind: "page" as const } };
    const minted = await call(commentProcedures.create, input, options);
    expect(minted.id).toMatch(UUIDV7);
    const optimistic = await call(
      commentProcedures.create,
      { ...input, id: CLIENT_COMMENT_ID },
      options,
    );
    expect(optimistic.id).toBe(CLIENT_COMMENT_ID);
    expect(
      (await call(commentProcedures.list, { pageId: f.page.id }, options)).map(({ id }) => id),
    ).toEqual(expect.arrayContaining([minted.id, CLIENT_COMMENT_ID]));
  });

  it("procedures and AI tools reject a comment id that isn't a UUIDv7", async () => {
    const f = await fixture();
    const options = procedureContext(f);
    const input = { pageId: f.page.id, message: "Feedback", target: { kind: "page" as const } };
    for (const id of [1, "1", crypto.randomUUID()]) {
      await expect(
        call(commentProcedures.create, { ...input, id } as never, options),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        call(
          commentProcedures.setResolved,
          { pageId: f.page.id, id, resolved: true } as never,
          options,
        ),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(
        await runService(
          callTool(f.ctx, {
            projectId: f.project.id,
            name: "resolveComment",
            arguments: { pageId: f.page.id, id },
          }),
        ),
      ).toMatchObject({ ok: false });
    }
    expect(await call(commentProcedures.list, { pageId: f.page.id }, options)).toEqual([]);
  });
});
