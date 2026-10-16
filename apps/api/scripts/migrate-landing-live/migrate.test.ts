import { uuidv7Schema } from "@camox/api-contract/ids";
import { describe, expect, it } from "vite-plus/test";

import { oldExport } from "./fixture";
import { checkMigration, migrateLive, type Row } from "./migrate";

const byText = (a: unknown, b: unknown) => String(a).localeCompare(String(b));

const now = 1_790_000_000_000;
const migrate = (exported = oldExport()) => migrateLive(exported, { projectSlug: "landing", now });

function only<T>(rows: T[], predicate: (row: T) => boolean): T {
  const matches = rows.filter(predicate);
  expect(matches).toHaveLength(1);
  return matches[0]!;
}

const json = (value: unknown) => JSON.parse(value as string);

describe("pages", () => {
  it("keeps the production environment's published pages, under fresh UUIDv7s", async () => {
    const { tables } = await migrate();

    expect(tables.pages.map((page) => page.full_path).sort(byText)).toEqual(["/", "/about"]);
    for (const page of tables.pages) {
      expect(uuidv7Schema.safeParse(page.id).success).toBe(true);
      expect(page.draft_id).toBeNull();
      expect(page.project_id).toBe(1);
    }
  });

  it("takes path, layout and parent from the current row, not the snapshot", async () => {
    const { tables } = await migrate();
    const home = only(tables.pages, (page) => page.nickname === "Home");
    const about = only(tables.pages, (page) => page.nickname === "About");

    expect(home.full_path).toBe("/");
    expect(home.layout_id).toBe("regular-page");
    expect(about.parent_page_id).toBe(home.id);
    expect(about.path_segment).toBe("about");
  });
});

describe("auth and projects", () => {
  it("copies the better-auth tables as they are", async () => {
    const exported = oldExport();
    const { tables } = await migrate(exported);

    for (const table of [
      "user",
      "account",
      "session",
      "verification",
      "organization",
      "member",
      "invitation",
    ] as const) {
      expect(tables[table]).toEqual(exported[table]);
    }
  });

  it("copies projects as they are, leaving out those whose organization is gone", async () => {
    const exported = oldExport();
    const { tables, orphanedProjects } = await migrate(exported);

    expect(tables.projects).toEqual(exported.projects.filter((project) => project.id !== 3));
    expect(orphanedProjects).toEqual([3]);
  });

  it("starts other projects empty", async () => {
    const { tables } = await migrate();

    for (const [table, rows] of Object.entries(tables)) {
      if (table === "projects" || !rows.some((row) => "project_id" in row)) continue;
      expect(rows.every((row) => row.project_id === 1 || row.project_id === null)).toBe(true);
    }
  });
});

describe("definitions", () => {
  it("copy the production environment's into Live, with schema hashes", async () => {
    const { tables } = await migrate();

    expect(tables.block_definitions.map((row) => row.block_id).sort(byText)).toEqual([
      "footer",
      "hero",
      "navbar",
    ]);
    const navbar = only(tables.block_definitions, (row) => row.block_id === "navbar");
    expect(navbar).toMatchObject({ draft_id: null, project_id: 1, synced: 1 });
    expect(navbar).not.toHaveProperty("synced_published_data");
    expect(navbar.schema_hash).toMatch(/^[0-9a-f]{64}$/);
    // Same schemas, different synced flag: the hash covers what shapes content.
    const hero = only(tables.block_definitions, (row) => row.block_id === "hero");
    expect(hero.schema_hash).not.toBe(navbar.schema_hash);

    const layout = only(tables.layouts, () => true);
    expect(layout).toMatchObject({ layout_id: "regular-page", kind: "curated", draft_id: null });
    expect(layout.schema_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("blocks and repeatable items", () => {
  it("come from each page's and layout's published checkpoint", async () => {
    const { tables } = await migrate();
    const home = only(tables.pages, (page) => page.nickname === "Home");
    const hero = only(tables.blocks, (block) => block.page_id === home.id && block.type === "hero");

    expect(json(hero.content).title).toBe("Welcome");
    expect(tables.blocks.map((block) => block.type).sort(byText)).toEqual([
      "footer",
      "hero",
      "hero",
      "navbar",
    ]);
    const footer = only(tables.blocks, (block) => block.type === "footer");
    expect(footer).toMatchObject({ page_id: null, layout_id: "regular-page", slot: "after" });
    for (const block of tables.blocks) {
      expect(uuidv7Schema.safeParse(block.id).success).toBe(true);
      expect(block.draft_id).toBeNull();
      expect(block.project_id).toBe(1);
    }
  });

  it("keep their item trees under fresh ids", async () => {
    const { tables } = await migrate();
    const hero = only(
      tables.blocks,
      (block) => block.type === "hero" && json(block.content).title === "Welcome",
    );
    const feature = only(tables.repeatable_items, (item) => item.field_name === "features");
    const point = only(tables.repeatable_items, (item) => item.field_name === "points");

    expect(feature).toMatchObject({ block_id: hero.id, parent_item_id: null });
    expect(point).toMatchObject({ block_id: hero.id, parent_item_id: feature.id });
    expect(uuidv7Schema.safeParse(point.id).success).toBe(true);
  });
});

describe("synced content", () => {
  it("comes from the definition's published data, and placements hold nothing", async () => {
    const { tables } = await migrate();
    const shared = only(tables.shared_contents, () => true);
    const placement = only(tables.blocks, (block) => block.type === "navbar");

    expect(shared).toMatchObject({ id: "1:navbar", project_id: 1, type: "navbar", draft_id: null });
    expect(json(shared.settings)).toEqual({ sticky: true });
    expect(json(placement.content)).toEqual({});
    expect(placement.settings).toBeNull();
  });

  it("keeps the published items under the shared content, not the placement's own", async () => {
    const { tables } = await migrate();
    const links = tables.repeatable_items.filter((item) => item.field_name === "links");

    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      block_id: null,
      project_id: 1,
      shared_content_type: "navbar",
    });
    expect(json(links[0]!.content).link.text).toBe("Home");
  });
});

describe("order", () => {
  it("keeps the order Live rendered items in, rewriting positions that disagree", async () => {
    const { tables } = await migrate();
    const socials = tables.repeatable_items
      .filter((item) => item.field_name === "socials")
      .sort((a, b) => (String(a.position) < String(b.position) ? -1 : 1))
      .map((item) => json(item.content).label);

    expect(socials).toEqual(["First", "Second"]);
  });

  it("keeps positions that already agree", async () => {
    const { tables } = await migrate();
    const feature = only(tables.repeatable_items, (item) => item.field_name === "features");
    const footer = only(tables.blocks, (block) => block.type === "footer");

    expect(feature.position).toBe("a0");
    expect(footer.position).toBe("a0");
  });
});

describe("files", () => {
  it("keep their R2 keys and URLs, under fresh UUIDv7s", async () => {
    const { tables } = await migrate();

    expect(tables.files.map((file) => file.blob_id).sort(byText)).toEqual(["blob-300", "blob-301"]);
    const logo = only(tables.files, (file) => file.blob_id === "blob-300");
    expect(logo).toMatchObject({
      url: "https://api.camox.dev/files/serve/1/300.png",
      path: "1/300.png",
      project_id: 1,
      draft_id: null,
    });
    expect(uuidv7Schema.safeParse(logo.id).success).toBe(true);
  });

  it("make metadata generated where the AI flag was unset, and manual where it was off", async () => {
    const { tables } = await migrate();
    const logo = only(tables.files, (file) => file.blob_id === "blob-300");
    const manual = only(tables.files, (file) => file.blob_id === "blob-301");

    expect(logo).toMatchObject({ alt: null, filename: null });
    expect(manual).toMatchObject({ alt: "Manual alt", filename: "manual.png" });
    const values = tables.generated_values.filter((value) => value.entity === "file");
    expect(values).toHaveLength(1);
    expect(values[0]).toMatchObject({ entity_id: logo.id, type: "fileMetadata", draft_id: null });
    expect(json(values[0]!.value)).toEqual({ alt: "Logo", filename: "logo.png" });
  });
});

describe("generated values", () => {
  const valueOf = (tables: Record<string, Row[]>, entity: string, entityId: unknown) =>
    tables.generated_values
      .filter((value) => value.entity === entity && value.entity_id === entityId)
      .map((value) => ({ type: value.type, value: json(value.value) }));

  it("make a page's SEO generated where the AI flag was unset, and manual where it was off", async () => {
    const { tables } = await migrate();
    const home = only(tables.pages, (page) => page.nickname === "Home");
    const about = only(tables.pages, (page) => page.nickname === "About");

    expect(home).toMatchObject({ meta_title: null, meta_description: null });
    expect(valueOf(tables, "page", home.id)).toEqual([
      { type: "seo", value: { metaTitle: "Home title", metaDescription: "Home description" } },
    ]);
    expect(about).toMatchObject({
      meta_title: "About title",
      meta_description: "About description",
    });
    expect(valueOf(tables, "page", about.id)).toEqual([]);
  });

  it("carry the published summaries of blocks, items and synced content", async () => {
    const { tables } = await migrate();
    const hero = only(tables.blocks, (block) => json(block.content).title === "Welcome");
    const feature = only(tables.repeatable_items, (item) => item.field_name === "features");
    const link = only(tables.repeatable_items, (item) => item.field_name === "links");
    const placement = only(tables.blocks, (block) => block.type === "navbar");

    expect(valueOf(tables, "block", hero.id)).toEqual([
      { type: "summary", value: { summary: "A hero" } },
    ]);
    expect(valueOf(tables, "repeatableItem", feature.id)).toEqual([
      { type: "summary", value: { summary: "First feature" } },
    ]);
    expect(valueOf(tables, "sharedContent", "1:navbar")).toEqual([
      { type: "summary", value: { summary: "The navbar" } },
    ]);
    expect(valueOf(tables, "repeatableItem", link.id)).toEqual([
      { type: "summary", value: { summary: "Home link" } },
    ]);
    // Empty summaries were never generated.
    const point = only(tables.repeatable_items, (item) => item.field_name === "points");
    expect(valueOf(tables, "repeatableItem", point.id)).toEqual([]);
    expect(valueOf(tables, "block", placement.id)).toEqual([]);
  });
});

describe("comments", () => {
  it("come along when their anchor survives, with their ids rewritten", async () => {
    const { tables } = await migrate();
    const home = only(tables.pages, (page) => page.nickname === "Home");
    const hero = only(tables.blocks, (block) => json(block.content).title === "Welcome");
    const feature = only(tables.repeatable_items, (item) => item.field_name === "features");

    expect(tables.comments.map((comment) => comment.message).sort(byText)).toEqual([
      "Shorter?",
      "Typo",
    ]);
    const onBlock = only(tables.comments, (comment) => comment.message === "Shorter?");
    expect(uuidv7Schema.safeParse(onBlock.id).success).toBe(true);
    expect(onBlock).toMatchObject({
      project_id: 1,
      draft_id: null,
      addressed_in_draft_id: null,
      page_id: home.id,
      block_id: null,
      item_id: null,
      resolved: 0,
    });
    expect(json(onBlock.target)).toEqual({
      kind: "block-field",
      blockId: hero.id,
      fieldName: "title",
    });
    const onItem = only(tables.comments, (comment) => comment.message === "Typo");
    expect(onItem).toMatchObject({ block_id: hero.id, item_id: feature.id, resolved: 1 });
    expect(json(onItem.target)).toEqual({
      kind: "item-field",
      blockId: hero.id,
      itemId: feature.id,
      fieldName: "title",
    });
  });
});

describe("ids inside content", () => {
  it("are rewritten to the new ids of files, pages and items", async () => {
    const { tables } = await migrate();
    const fileId = (blob: string) => only(tables.files, (file) => file.blob_id === blob).id;
    const pageId = (nickname: string) =>
      only(tables.pages, (page) => page.nickname === nickname).id;
    const hero = json(
      only(tables.blocks, (block) => json(block.content).title === "Welcome").content,
    );

    expect(hero.image).toEqual({ _fileId: fileId("blob-300") });
    expect(hero.cta).toEqual({ type: "page", pageId: pageId("About"), text: "About" });
    expect(JSON.parse(hero.body).root.children[0].url).toBe(
      `camox:page:${String(pageId("About"))}`,
    );
    const feature = only(tables.repeatable_items, (item) => item.field_name === "features");
    expect(json(feature.content).icon).toEqual({ _fileId: fileId("blob-300") });
    const shared = only(tables.shared_contents, () => true);
    expect(json(shared.content).logo).toEqual({ _fileId: fileId("blob-300") });
    const link = only(tables.repeatable_items, (item) => item.field_name === "links");
    expect(json(link.content).link.pageId).toBe(pageId("Home"));
  });

  it("are stored empty and listed when they point at nothing", async () => {
    const { tables, dangling } = await migrate();
    const heroRow = only(tables.blocks, (block) => json(block.content).title === "Welcome");
    const hero = json(heroRow.content);

    expect(hero.gallery).toEqual([
      { _fileId: only(tables.files, (file) => file.blob_id === "blob-301").id },
    ]);
    expect(hero.broken).toEqual({ type: "page", pageId: "", text: "Unpublished" });
    expect(JSON.parse(hero.body).root.children[1].url).toBe("camox:page:");
    expect(dangling).toEqual(
      expect.arrayContaining([
        { kind: "file", id: 399, in: { entity: "block", id: heroRow.id } },
        { kind: "page", id: 102, in: { entity: "block", id: heroRow.id } },
        { kind: "page", id: 999, in: { entity: "block", id: heroRow.id } },
      ]),
    );
    expect(dangling).toHaveLength(3);
  });
});

describe("invariant checks", () => {
  const options = { projectSlug: "landing", now };

  it("pass on a migration", async () => {
    const exported = oldExport();
    const migration = await migrateLive(exported, options);

    expect(checkMigration(exported, migration, options)).toEqual([]);
  });

  it("catch an id inside content that resolves to nothing", async () => {
    const exported = oldExport();
    const migration = await migrateLive(exported, options);
    const hero = only(migration.tables.blocks, (block) => json(block.content).title === "Welcome");
    hero.content = JSON.stringify({ ...json(hero.content), image: { _fileId: "missing" } });

    expect(checkMigration(exported, migration, options)).toEqual([
      `block ${String(hero.id)}: file missing resolves to nothing`,
    ]);
  });

  it("catch a row whose owner resolves to nothing", async () => {
    const exported = oldExport();
    const migration = await migrateLive(exported, options);
    const feature = only(
      migration.tables.repeatable_items,
      (item) => item.field_name === "features",
    );
    feature.block_id = "missing";

    expect(checkMigration(exported, migration, options)).toEqual(
      expect.arrayContaining([
        `repeatableItem ${String(feature.id)}: block missing resolves to nothing`,
      ]),
    );
  });

  it("catch counts that don't match the export's", async () => {
    const exported = oldExport();
    const migration = await migrateLive(exported, options);
    migration.tables.session = [];
    migration.tables.pages.pop();

    expect(checkMigration(exported, migration, options)).toEqual(
      expect.arrayContaining(["session: 0 rows, expected 1", "pages: 1 rows, expected 2"]),
    );
  });

  it("fail the migration before anything is written", async () => {
    const exported = oldExport();
    const checkpoint = only(exported.page_checkpoints, (row) => row.id === 61);
    const snapshot = json(checkpoint.snapshot);
    // An item under a block the snapshot doesn't hold: nothing would own it.
    snapshot.repeatableItems.push({ id: 2999, blockId: 1999, fieldName: "x", content: {} });
    checkpoint.snapshot = JSON.stringify(snapshot);

    await expect(migrateLive(exported, options)).rejects.toThrow(
      /repeatable_items: 5 rows, expected 6/,
    );
  });
});
