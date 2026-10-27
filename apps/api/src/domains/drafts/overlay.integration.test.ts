import { generateUuidv7 } from "@camox/api-contract/ids";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";

import { createProjectFixture, noArtifactFields } from "../../../test/fixtures";
import { runService } from "../../lib/run-service";
import { blocks, drafts } from "../../schema";
import * as overlay from "./overlay";
import { RELEASE, type Draft } from "./scope";

const run = runService;

async function fixture(suffix: string) {
  const base = await createProjectFixture(suffix);
  const openDraft = async (): Promise<Draft> => {
    const draft = await base.db
      .insert(drafts)
      .values({
        projectId: base.project.id,
        createdBy: base.memberUser.id,
        createdAt: Date.now(),
      })
      .returning()
      .get();
    return { id: draft.id, projectId: draft.projectId };
  };
  const pageId = generateUuidv7();
  const newBlock = (values: { position: string; content?: unknown; id?: string }) => ({
    id: values.id,
    projectId: base.project.id,
    pageId,
    type: "hero",
    content: values.content ?? { title: "Live" },
    position: values.position,
    createdAt: 1,
    updatedAt: 1,
  });
  const live = (await run(
    overlay.insert(base.db, RELEASE, blocks, newBlock({ position: "a0" }), noArtifactFields),
  ))!;
  return { ...base, openDraft, pageId, newBlock, live };
}

const titleOf = (row: { content: unknown } | undefined) =>
  (row?.content as { title?: string } | undefined)?.title;

describe("the draft overlay", () => {
  it("records the Live version the first write in a draft copied, counting a release's changes", async () => {
    const { db, openDraft, live } = await fixture("overlay-base-version");
    const draft = await openDraft();
    await run(
      overlay.update(
        db,
        RELEASE,
        blocks,
        live.id,
        { content: { title: "Second" } },
        noArtifactFields,
      ),
    );
    await run(
      overlay.update(
        db,
        RELEASE,
        blocks,
        live.id,
        { content: { title: "Third" } },
        noArtifactFields,
      ),
    );

    await run(
      overlay.update(db, draft, blocks, live.id, { content: { title: "Draft" } }, noArtifactFields),
    );
    await run(
      overlay.update(
        db,
        RELEASE,
        blocks,
        live.id,
        { content: { title: "Fourth" } },
        noArtifactFields,
      ),
    );
    const copy = await run(
      overlay.update(
        db,
        draft,
        blocks,
        live.id,
        { content: { title: "Draft 2" } },
        noArtifactFields,
      ),
    );

    expect(copy).toMatchObject({ baseVersion: 3, content: { title: "Draft 2" } });
    expect(await run(overlay.get(db, null, blocks, live.id))).toMatchObject({
      version: 4,
      baseVersion: null,
      publishedAt: expect.any(Number),
      publishedBy: null,
    });
  });

  it("keeps a block a draft creates in that draft, and drops it without a trace when deleted", async () => {
    const { db, openDraft, newBlock, pageId } = await fixture("overlay-created");
    const draft = await openDraft();

    const created = (await run(
      overlay.insert(
        db,
        draft,
        blocks,
        newBlock({ position: "a1", content: { title: "New" } }),
        noArtifactFields,
      ),
    ))!;

    expect(titleOf(await run(overlay.get(db, draft, blocks, created.id)))).toBe("New");
    expect(await run(overlay.get(db, null, blocks, created.id))).toBeUndefined();

    await run(overlay.remove(db, draft, blocks, created.id));
    expect(await db.select().from(blocks).where(eq(blocks.id, created.id))).toHaveLength(0);
    expect(await run(overlay.select(db, draft, blocks, eq(blocks.pageId, pageId)))).toHaveLength(1);
  });

  it("refuses an id the target already reads", async () => {
    const { db, openDraft, newBlock, live } = await fixture("overlay-conflict");
    const draft = await openDraft();

    const inDraft = await run(
      overlay.insert(
        db,
        draft,
        blocks,
        newBlock({ id: live.id, position: "a1" }),
        noArtifactFields,
      ),
    );
    const inLive = await run(
      overlay.insert(
        db,
        RELEASE,
        blocks,
        newBlock({ id: live.id, position: "a1" }),
        noArtifactFields,
      ),
    );

    expect(inDraft).toBeUndefined();
    expect(inLive).toBeUndefined();
  });

  it("orders blocks with the same position by id", async () => {
    const { db, openDraft, newBlock, pageId, live } = await fixture("overlay-order");
    const draft = await openDraft();
    const ids = [generateUuidv7(), generateUuidv7()];
    // Both drafts picked the same key between Live's blocks.
    await run(
      overlay.insert(db, draft, blocks, newBlock({ id: ids[1], position: "a0" }), noArtifactFields),
    );
    await run(
      overlay.insert(db, draft, blocks, newBlock({ id: ids[0], position: "a0" }), noArtifactFields),
    );

    const rows = overlay.sortByPosition(
      await run(overlay.select(db, draft, blocks, eq(blocks.pageId, pageId))),
    );

    expect(rows.map((row) => row.id)).toEqual([live.id, ...ids].sort());
  });
});
