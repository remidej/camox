import type { CommentTarget } from "@camox/api-contract";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { createProjectFixture, createServiceContext } from "../../../test/fixtures";
import {
  blockDefinitions,
  blocks,
  comments,
  environments,
  layouts,
  pages,
  repeatableItems,
} from "../../schema";
import { replicateEnvironment } from "../environments/service";
import { createComment, listComments } from "./service";

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
      layoutId: base.layout.id,
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
    createComment(ctx, { id: crypto.randomUUID(), pageId: page.id, message, target });
  return { ...base, ctx, page, block, item, nested, create };
}

describe("comments", () => {
  it("lists repeated nested targets with a fixed query budget", async () => {
    const f = await fixture();
    const layoutBlock = await f.db
      .insert(blocks)
      .values({ ...f.block, id: undefined, pageId: null, layoutId: f.layout.id })
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
      expect(await listComments(f.ctx, { pageId: f.page.id })).toHaveLength(1);
      const singleCount = prepare.mock.calls.length;
      expect(singleCount).toBeLessThanOrEqual(7);
      for (let index = 0; index < 63; index++) {
        const target = targets[index % targets.length]!;
        await f.db.insert(comments).values({
          id: crypto.randomUUID(),
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
      const result = await listComments(f.ctx, { pageId: f.page.id });
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
        id: undefined,
        pageId: null,
        layoutId: f.layout.id,
      })
      .returning()
      .get();
    const input = {
      id: crypto.randomUUID(),
      pageId: f.page.id,
      message: "Shared header",
      target: { kind: "block" as const, blockId: layoutBlock.id },
    };
    vi.mocked(broadcastInvalidation).mockClear();
    const results = await Promise.all([createComment(f.ctx, input), createComment(f.ctx, input)]);
    expect(results[0]).toEqual(results[1]);
    expect(broadcastInvalidation).toHaveBeenCalledTimes(1);
    expect(broadcastInvalidation).toHaveBeenCalledWith(
      expect.objectContaining({
        targets: [["camox", "comments", "list", f.page.id]],
      }),
    );
    expect(await listComments(f.ctx, { pageId: sibling.id })).toEqual([]);
    await expect(
      createComment(f.ctx, {
        ...input,
        id: crypto.randomUUID(),
        pageId: sibling.id,
        target: { kind: "block", blockId: f.block.id },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await f.db.delete(blocks).where(eq(blocks.id, layoutBlock.id));
    expect(await createComment(f.ctx, input)).toMatchObject({ id: input.id, target: null });
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
      const input = { id: crypto.randomUUID(), pageId: f.page.id, message: " Feedback ", target };
      const first = await createComment(f.ctx, input);
      expect(first).toMatchObject({
        message: "Feedback",
        target,
        author: { name: "Member", image: null },
        environmentId: f.environment.id,
        createdAt: expect.any(Number),
      });
      expect(await createComment(f.ctx, input)).toEqual(first);
      await expect(createComment(f.ctx, { ...input, message: "Changed" })).rejects.toMatchObject({
        code: "CONFLICT",
      });
    }
    expect(await listComments(f.ctx, { pageId: f.page.id })).toHaveLength(targets.length);
  });

  it("rejects anonymous/nonmember/wrong-environment access and malformed/foreign targets", async () => {
    const f = await fixture();
    const other = await fixture();
    const input = {
      id: crypto.randomUUID(),
      pageId: f.page.id,
      message: "Feedback",
      target: { kind: "page" as const },
    };
    for (const [ctx, code] of [
      [{ ...f.ctx, user: null }, "UNAUTHORIZED"],
      [{ ...f.ctx, user: f.outsiderUser }, "FORBIDDEN"],
      [{ ...f.ctx, environmentName: "other" }, "NOT_FOUND"],
    ] as const) {
      await expect(createComment(ctx, input)).rejects.toMatchObject({ code });
      await expect(listComments(ctx, { pageId: f.page.id })).rejects.toMatchObject({ code });
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
    await expect(createComment(f.ctx, { ...input, id: "invalid" })).rejects.toThrow();
    await expect(createComment(f.ctx, { ...input, message: " " })).rejects.toThrow();
    await expect(
      createComment(f.ctx, { ...input, target: { kind: "page", x: 1 } } as never),
    ).rejects.toThrow();
    await expect(
      createComment(f.ctx, { ...input, authorId: f.outsiderUser.id } as never),
    ).rejects.toThrow();
  });

  it("retains deleted targets as unavailable and cannot reattach a reused ID", async () => {
    const f = await fixture();
    await f.create({ kind: "item", blockId: f.block.id, itemId: f.item.id });
    await f.db.delete(repeatableItems).where(eq(repeatableItems.id, f.item.id));
    await f.db.insert(repeatableItems).values({ ...f.item });
    expect(await listComments(f.ctx, { pageId: f.page.id })).toMatchObject([{ target: null }]);
    await f.create({ kind: "block-field", blockId: f.block.id, fieldName: "title" });
    await f.db
      .update(blockDefinitions)
      .set({ contentSchema: { properties: {} } })
      .where(eq(blockDefinitions.environmentId, f.environment.id));
    expect((await listComments(f.ctx, { pageId: f.page.id })).every((c) => c.target === null)).toBe(
      true,
    );
  });

  it("replaces destination comments, remaps nested targets, preserves provenance and unavailable feedback", async () => {
    const f = await fixture();
    const now = Date.now();
    const destination = await f.db
      .insert(environments)
      .values({
        projectId: f.project.id,
        name: "dev:test",
        type: "development",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    const layout = await f.db
      .insert(layouts)
      .values({
        ...f.layout,
        id: undefined,
        environmentId: destination.id,
      })
      .returning()
      .get();
    const definition = await f.db
      .select()
      .from(blockDefinitions)
      .where(eq(blockDefinitions.environmentId, f.environment.id))
      .get();
    await f.db
      .insert(blockDefinitions)
      .values({ ...definition!, id: undefined, environmentId: destination.id });
    const page = await f.db
      .insert(pages)
      .values({
        ...f.page,
        id: undefined,
        environmentId: destination.id,
        layoutId: layout.id,
      })
      .returning()
      .get();
    const old = await createComment(
      { ...f.ctx, environmentName: destination.name },
      {
        id: crypto.randomUUID(),
        pageId: page.id,
        message: "Old destination",
        target: { kind: "page" },
      },
    );
    const original = await f.create({
      kind: "item-field",
      blockId: f.block.id,
      itemId: f.nested.id,
      fieldName: "text",
    });
    const unavailable = await f.create({ kind: "block", blockId: f.block.id });
    // Delete a separate target without removing the nested target.
    const deleted = await f.db
      .insert(blocks)
      .values({ ...f.block, id: undefined })
      .returning()
      .get();
    await f.create({ kind: "block", blockId: deleted.id });
    await f.db.delete(blocks).where(eq(blocks.id, deleted.id));
    const result = await replicateEnvironment(f.ctx, {
      projectId: f.project.id,
      sourceEnvName: "production",
      targetEnvName: destination.name,
    });
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
