import { eq } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";

import { createProjectFixture, seedLive } from "../../../test/fixtures";
import { blocks, layouts } from "../../schema";

// Live's writers keep each Live page's and layout's `content_updated_at` in step with its
// blocks: the SDK keeps a layout's cached blocks across navigations while it stays the same.

const longAgo = 1;

describe("Live follow-ups of releases", () => {
  it("bumps a layout's content time when a release adds a block to it", async () => {
    const { db, project, layout } = await createProjectFixture("follow-up-release");
    await db.update(layouts).set({ contentUpdatedAt: longAgo });

    await seedLive(db, blocks, {
      projectId: project.id,
      layoutId: layout.layoutId,
      slot: "after",
      type: "hero",
      content: { title: "Footer" },
      position: "a0",
      createdAt: longAgo,
      updatedAt: longAgo,
    });

    const after = await db.select().from(layouts).where(eq(layouts.rowId, layout.rowId)).get();
    expect(after!.contentUpdatedAt).toBeGreaterThan(longAgo);
  });
});
