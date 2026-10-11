import { describe, expect, it } from "vitest";

import { createProjectFixture, createServiceContext } from "../../../test/fixtures";
import { runService } from "../../lib/run-service";
import { blocks, environments, pages } from "../../schema";
import { getBlocksUsageCounts, getPagesUsingBlock } from "./service";

async function fixture(suffix: string) {
  const base = await createProjectFixture(suffix);
  const ctx = createServiceContext(base.db, base.memberUser);
  const now = Date.now();
  const development = await base.db
    .insert(environments)
    .values({
      projectId: base.project.id,
      name: "development",
      type: "development",
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  const insertPage = (environmentId: number, fullPath: string, nickname: string) =>
    base.db
      .insert(pages)
      .values({
        projectId: base.project.id,
        environmentId,
        layoutId: base.layout.id,
        pathSegment: fullPath.slice(1),
        fullPath,
        nickname,
        contentUpdatedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
  const place = (type: string, owner: { pageId: number } | { layoutId: number }, position = "a0") =>
    base.db
      .insert(blocks)
      .values({ ...owner, type, content: {}, position, createdAt: now, updatedAt: now })
      .run();
  return { ...base, ctx, development, insertPage, place };
}

describe("getPagesUsingBlock", () => {
  it("returns each Page of the environment that places the block once", async () => {
    const { ctx, project, environment, insertPage, place } = await fixture("pages-using");
    const about = await insertPage(environment.id, "/about", "About");
    const home = await insertPage(environment.id, "/home", "Home");
    const pricing = await insertPage(environment.id, "/pricing", "Pricing");
    await place("hero", { pageId: home.id }, "a0");
    await place("hero", { pageId: home.id }, "a1");
    await place("hero", { pageId: about.id });
    await place("faq", { pageId: pricing.id });

    const result = await runService(
      getPagesUsingBlock(ctx, { projectId: project.id, type: "hero" }),
    );

    expect(result).toEqual([
      { id: about.id, nickname: "About", fullPath: "/about" },
      { id: home.id, nickname: "Home", fullPath: "/home" },
    ]);
    // Usage counts count placements, which is why Pages need their own query.
    const counts = await runService(getBlocksUsageCounts(ctx, { projectId: project.id }));
    expect(counts.find(({ type }) => type === "hero")?.count).toBe(3);
  });

  it("leaves out other environments and layout placements", async () => {
    const { ctx, project, layout, development, insertPage, place } = await fixture("pages-scope");
    const draft = await insertPage(development.id, "/draft", "Draft");
    await place("hero", { pageId: draft.id });
    await place("hero", { layoutId: layout.id });

    expect(
      await runService(getPagesUsingBlock(ctx, { projectId: project.id, type: "hero" })),
    ).toEqual([]);
    expect(
      await runService(
        getPagesUsingBlock(
          { ...ctx, environmentName: "development" },
          { projectId: project.id, type: "hero" },
        ),
      ),
    ).toEqual([{ id: draft.id, nickname: "Draft", fullPath: "/draft" }]);
  });
});
