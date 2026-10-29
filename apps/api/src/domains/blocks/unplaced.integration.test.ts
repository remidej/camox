import { describe, expect, it } from "vite-plus/test";

import {
  createProjectFixture,
  createServiceContext,
  inScope,
  startDraft,
  syncDefinitionSet,
} from "../../../test/fixtures";
import { runService } from "../../lib/run-service";
import { collectionDefinitions, collectionRecords, files } from "../../schema";
import * as overlay from "../drafts/overlay";
import { draftOf } from "../drafts/scope";
import { getUnplacedBlock } from "./service";

// A Block Definition rendered without placing it anywhere, as the agent's `look` shows it: its
// default content and Block Settings, with overrides merged on in the content tools' shape.

const now = 1_700_000_000_000;

async function fixture() {
  const base = await createProjectFixture(`unplaced-${crypto.randomUUID()}`);
  const { db, project, memberUser } = base;
  await syncDefinitionSet(db, project, {
    blocks: [
      {
        blockId: "hero",
        title: "Hero",
        description: "A hero",
        contentSchema: {
          type: "object",
          properties: {
            title: { type: "string", fieldType: "String", default: "Welcome", maxLength: 40 },
            subtitle: { type: "string", fieldType: "String", default: "Hello there" },
            photo: { type: "object", fieldType: "Image" },
            author: { fieldType: "Reference", collectionId: "people", default: null },
            items: {
              type: "array",
              fieldType: "Repeater",
              minItems: 1,
              items: {
                type: "object",
                properties: { label: { type: "string", fieldType: "String", default: "Item" } },
              },
            },
          },
        },
        settingsSchema: {
          type: "object",
          properties: {
            colorScheme: { type: "string", enum: ["light", "dark"], default: "light" },
          },
        },
      },
    ],
  });
  await db.insert(collectionDefinitions).values({
    projectId: project.id,
    collectionId: "people",
    title: "People",
    description: "",
    toTitle: "{{name}}",
    contentSchema: {
      type: "object",
      properties: { name: { type: "string", fieldType: "String", default: "" } },
    },
    schemaHash: "people",
  });
  const draftId = await startDraft(db, project.id, memberUser.id);
  const draft = draftOf({ id: draftId, projectId: project.id });
  const ctx = inScope(createServiceContext(db, memberUser), draft);
  const look = (input: { content?: unknown; settings?: unknown }, type = "hero") =>
    runService(getUnplacedBlock(ctx, { projectUuid: project.uuid, type, ...input }));
  return { db, draft, project, look };
}

describe("an unplaced block of a Block Definition", () => {
  it("shows the definition's default content and Block Settings", async () => {
    const { look } = await fixture();

    const { block, repeatableItems } = await look({});

    expect(block).toMatchObject({
      type: "hero",
      content: {
        title: "Welcome",
        subtitle: "Hello there",
        items: [{ _itemId: expect.any(String) }],
      },
      settings: { colorScheme: "light" },
    });
    expect(repeatableItems.map((item) => item.content)).toEqual([{ label: "Item" }]);
  });

  it("merges content and Block Setting overrides onto the defaults, Repeatable Items as arrays", async () => {
    const { look } = await fixture();

    const { block, repeatableItems } = await look({
      content: { title: "Spring sale", items: [{ label: "One" }, { label: "Two" }] },
      settings: { colorScheme: "dark" },
    });

    expect(block.content).toMatchObject({ title: "Spring sale", subtitle: "Hello there" });
    expect(block.settings).toEqual({ colorScheme: "dark" });
    const markers = (block.content as { items: { _itemId: string }[] }).items;
    expect(
      markers.map(({ _itemId }) => repeatableItems.find((item) => item.id === _itemId)?.content),
    ).toEqual([{ label: "One" }, { label: "Two" }]);
  });

  it("refuses an override the Content Schema or Settings Schema refuses, with the schema's message", async () => {
    const { look } = await fixture();

    await expect(look({ content: { title: "x".repeat(41) } })).rejects.toThrow(/title/);
    await expect(look({ settings: { colorScheme: "purple" } })).rejects.toThrow(/colorScheme/);
  });

  it("refuses a Block Definition the draft doesn't have", async () => {
    const { look } = await fixture();

    await expect(look({}, "pricing")).rejects.toThrow(/pricing/);
  });

  it("shows the File and the Collection Record of the draft an override names", async () => {
    const { db, draft, project, look } = await fixture();
    const file = await runService(
      overlay.insert(db, draft, files, {
        projectId: project.id,
        url: "https://example.com/team.png",
        filename: "team.png",
        alt: "The team",
        mimeType: "image/png",
        size: 1,
        blobId: "team",
        path: "team.png",
        createdAt: now,
        updatedAt: now,
      }),
    );
    const record = await runService(
      overlay.insert(db, draft, collectionRecords, {
        projectId: project.id,
        collectionId: "people",
        content: { name: "Ada" },
        createdAt: now,
        updatedAt: now,
      }),
    );

    const { block, files: shown } = await look({
      content: { photo: { _fileId: file!.id }, author: record!.id },
    });

    expect(shown.map(({ id, url }) => ({ id, url }))).toEqual([
      { id: file!.id, url: "https://example.com/team.png" },
    ]);
    expect(block.references).toMatchObject({
      author: { id: record!.id, content: { name: "Ada" } },
    });
  });

  it("refuses a Collection Record the draft doesn't have", async () => {
    const { look } = await fixture();

    await expect(look({ content: { author: crypto.randomUUID() } })).rejects.toThrow(/author/);
  });
});
