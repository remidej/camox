import { describe, expect, it } from "vitest";

import { createProjectFixture, createServiceContext } from "../../../test/fixtures";
import { runService } from "../../lib/run-service";
import { blocks, pages } from "../../schema";
import { getBlocksUsageCounts, getPagesUsingBlock } from "./service";

async function fixture(suffix: string) {
  const base = await createProjectFixture(suffix);
  const ctx = createServiceContext(base.db, base.memberUser);
  const now = Date.now();
  const insertPage = (projectId: number, fullPath: string, nickname: string) =>
    base.db
      .insert(pages)
      .values({
        projectId,
        layoutId: base.layout.layoutId,
        pathSegment: fullPath.slice(1),
        fullPath,
        nickname,
        contentUpdatedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
  const place = (
    type: string,
    owner: { projectId: number } & ({ pageId: string } | { layoutId: string }),
    position = "a0",
  ) =>
    base.db
      .insert(blocks)
      .values({ ...owner, type, content: {}, position, createdAt: now, updatedAt: now })
      .run();
  return { ...base, ctx, insertPage, place };
}

describe("getPagesUsingBlock", () => {
  it("returns each Page of the project that places the block once", async () => {
    const { ctx, project, insertPage, place } = await fixture("pages-using");
    const about = await insertPage(project.id, "/about", "About");
    const home = await insertPage(project.id, "/home", "Home");
    const pricing = await insertPage(project.id, "/pricing", "Pricing");
    await place("hero", { projectId: project.id, pageId: home.id }, "a0");
    await place("hero", { projectId: project.id, pageId: home.id }, "a1");
    await place("hero", { projectId: project.id, pageId: about.id });
    await place("faq", { projectId: project.id, pageId: pricing.id });

    const result = await runService(
      getPagesUsingBlock(ctx, { projectId: project.id, type: "hero" }, null),
    );

    expect(result).toEqual([
      { id: about.id, nickname: "About", fullPath: "/about" },
      { id: home.id, nickname: "Home", fullPath: "/home" },
    ]);
    // Usage counts count placements, which is why Pages need their own query.
    const counts = await runService(getBlocksUsageCounts(ctx, { projectId: project.id }, null));
    expect(counts.find(({ type }) => type === "hero")?.count).toBe(3);
  });

  it("leaves out other projects and layout placements", async () => {
    const { ctx, project, layout, place } = await fixture("pages-scope");
    const other = await fixture("pages-scope-other");
    const elsewhere = await other.insertPage(other.project.id, "/elsewhere", "Elsewhere");
    await other.place("hero", { projectId: other.project.id, pageId: elsewhere.id });
    await place("hero", { projectId: layout.projectId, layoutId: layout.layoutId });

    expect(
      await runService(getPagesUsingBlock(ctx, { projectId: project.id, type: "hero" }, null)),
    ).toEqual([]);
    expect(
      await runService(
        getPagesUsingBlock(other.ctx, { projectId: other.project.id, type: "hero" }, null),
      ),
    ).toEqual([{ id: elsewhere.id, nickname: "Elsewhere", fullPath: "/elsewhere" }]);
  });
});
