import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import {
  createProjectFixture,
  createServiceContext,
  seedLive,
  seedLiveThrough,
} from "../../../test/fixtures";
import { runService } from "../../lib/run-service";
import { blocks, layouts, pages } from "../../schema";
import { upsertBlockDefinition } from "../block-definitions/service";
import { createBlock, deleteBlock, updateBlockContent } from "../blocks/service";
import { updatePage } from "../pages/service";

// Live's writers, publishing and releases, keep each Live page's and layout's
// `content_updated_at` in step with its blocks: the SDK keeps a layout's cached blocks across
// navigations while it stays the same.

const longAgo = 1;

async function fixture(suffix: string, { synced = false } = {}) {
  const base = await createProjectFixture(suffix);
  const { db, project, layout } = base;
  const ctx = createServiceContext(db, base.memberUser);
  await runService(
    upsertBlockDefinition(createServiceContext(db, null), {
      projectSlug: project.slug,
      deployToken: project.deployToken,
      blockId: "hero",
      title: "Hero",
      description: "Hero",
      synced,
      contentSchema: {
        type: "object",
        properties: { title: { fieldType: "String", type: "string" } },
        toMarkdown: ["# {{title}}"],
      },
    }),
  );
  const addPage = (fullPath: string) =>
    seedLive(db, pages, {
      projectId: project.id,
      layoutId: layout.layoutId,
      pathSegment: fullPath.slice(1),
      fullPath,
      nickname: fullPath,
      contentUpdatedAt: longAgo,
      createdAt: longAgo,
      updatedAt: longAgo,
    });
  /** Sets a Live page's or layout's content time far in the past, so any bump shows. */
  const age = async () => {
    await db.update(pages).set({ contentUpdatedAt: longAgo });
    await db.update(layouts).set({ contentUpdatedAt: longAgo });
  };
  const contentTimeOfPage = async (id: string) =>
    (await db.select().from(pages).where(eq(pages.id, id)).get())!.contentUpdatedAt;
  const contentTimeOfLayout = async () =>
    (await db.select().from(layouts).where(eq(layouts.rowId, layout.rowId)).get())!
      .contentUpdatedAt;
  const publishing = <A>(run: Parameters<typeof seedLiveThrough<A>>[2]) =>
    seedLiveThrough(ctx, project.id, run);
  return {
    ...base,
    ctx,
    addPage,
    age,
    contentTimeOfPage,
    contentTimeOfLayout,
    publishing,
  };
}

describe("Live follow-ups of publishing", () => {
  it("bumps a layout's content time when a publish changes one of its blocks", async () => {
    const f = await fixture("follow-up-layout");
    const block = await seedLive(f.db, blocks, {
      projectId: f.project.id,
      layoutId: f.layout.layoutId,
      slot: "before",
      type: "hero",
      content: { title: "Live" },
      position: "a0",
      createdAt: longAgo,
      updatedAt: longAgo,
    });
    await f.age();

    await f.publishing((draft) =>
      updateBlockContent(f.ctx, { id: block.id, content: { title: "Published" } }, draft),
    );

    expect(await f.contentTimeOfLayout()).toBeGreaterThan(longAgo);
  });

  it("bumps the page whose block a publish changes", async () => {
    const f = await fixture("follow-up-page");
    const page = await f.addPage("/");
    const block = await f.publishing((draft) =>
      createBlock(f.ctx, { pageId: page.id, type: "hero", content: { title: "Live" } }, draft),
    );
    await f.age();

    await f.publishing((draft) =>
      updateBlockContent(f.ctx, { id: block.id, content: { title: "Published" } }, draft),
    );

    expect(await f.contentTimeOfPage(page.id)).toBeGreaterThan(longAgo);
  });

  it("bumps the page a publish deletes a block from, even when the draft changed the page too", async () => {
    const f = await fixture("follow-up-delete");
    const page = await f.addPage("/");
    const block = await f.publishing((draft) =>
      createBlock(f.ctx, { pageId: page.id, type: "hero", content: { title: "Live" } }, draft),
    );
    await f.age();

    // The draft's copy of the page holds the content time it copied, which publishing keeps off
    // Live.
    await f.publishing((draft) =>
      Effect.andThen(updatePage(f.ctx, { id: page.id, nickname: "Home" }, draft), () =>
        deleteBlock(f.ctx, { id: block.id }, draft),
      ),
    );

    expect(await f.contentTimeOfPage(page.id)).toBeGreaterThan(longAgo);
  });

  it("bumps the pages placing a synced definition when a publish changes its shared content", async () => {
    const f = await fixture("follow-up-synced", { synced: true });
    const first = await f.addPage("/first");
    const second = await f.addPage("/second");
    const placement = await f.publishing((draft) =>
      createBlock(f.ctx, { pageId: first.id, type: "hero", content: { title: "Shared" } }, draft),
    );
    await f.publishing((draft) =>
      createBlock(f.ctx, { pageId: second.id, type: "hero", content: {} }, draft),
    );
    await f.age();

    await f.publishing((draft) =>
      updateBlockContent(f.ctx, { id: placement.id, content: { title: "Edited" } }, draft),
    );

    expect(await f.contentTimeOfPage(first.id)).toBeGreaterThan(longAgo);
    expect(await f.contentTimeOfPage(second.id)).toBeGreaterThan(longAgo);
  });
});

describe("Live follow-ups of releases", () => {
  it("bumps a layout's content time when a release adds a block to it", async () => {
    const f = await fixture("follow-up-release");
    await f.age();

    await seedLive(f.db, blocks, {
      projectId: f.project.id,
      layoutId: f.layout.layoutId,
      slot: "after",
      type: "hero",
      content: { title: "Footer" },
      position: "a0",
      createdAt: longAgo,
      updatedAt: longAgo,
    });

    expect(await f.contentTimeOfLayout()).toBeGreaterThan(longAgo);
  });
});
