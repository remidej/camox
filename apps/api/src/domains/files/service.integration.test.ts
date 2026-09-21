import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { createProjectFixture, createServiceContext } from "../../../test/fixtures";
import { blocks, environments, files, layouts, repeatableItems } from "../../schema";
import type { AppEnv } from "../../types";
import { callTool } from "../agent/service";
import { fileHonoRoutes } from "./routes";
import {
  saveGeneratedFileMetadata,
  getProjectFile,
  listFiles,
  replaceFile,
  updateFile,
} from "./service";

async function fixture() {
  const fixture = await createProjectFixture(crypto.randomUUID());
  const scheduleAiJob = vi.fn().mockResolvedValue(new Response(null));
  const baseContext = createServiceContext(fixture.db, fixture.memberUser);
  const bindings = {
    ...baseContext.env,
    AI_JOB_SCHEDULER: {
      idFromName: (name: string) => baseContext.env.AI_JOB_SCHEDULER.idFromName(name),
      get: () => ({ fetch: scheduleAiJob }),
    } as unknown as DurableObjectNamespace,
  };
  const ctx = { ...baseContext, env: bindings };
  const app = new Hono<AppEnv>();
  app.onError(() => new Response("Test request failed", { status: 500 }));
  app.use("*", async (c, next) => {
    c.set("db", fixture.db);
    c.set("user", fixture.memberUser);
    c.set("environmentName", "production");
    await next();
  });
  app.route("/files", fileHonoRoutes);
  async function upload(
    metadata: Record<string, string> = {},
    type = "image/png",
    filename = "hero.png",
    targetId?: number,
    contents = "image bytes",
  ) {
    const body = new FormData();
    body.set("file", new File([contents], filename, { type }));
    body.set("projectId", String(fixture.project.id));
    for (const [key, value] of Object.entries(metadata)) body.set(key, value);
    const execution = createExecutionContext();
    const response = await app.request(
      targetId === undefined
        ? "http://localhost/files/upload"
        : `http://localhost/files/${targetId}/content`,
      { method: "POST", body },
      bindings,
      execution,
    );
    await waitOnExecutionContext(execution);
    return response;
  }
  return { ...fixture, ctx, app, upload, scheduleAiJob };
}

describe("media persistence", () => {
  it("persists supplied and empty alt text before scheduling, and serves the stored bytes", async () => {
    const { upload, db, app, scheduleAiJob } = await fixture();
    for (const alt of ["Product screenshot", ""]) {
      scheduleAiJob.mockClear();
      const response = await upload({ alt }, "image/png", "hero café #1.png");
      expect(response.status).toBe(201);
      const record = await response.json<typeof files.$inferSelect>();
      expect(record).toMatchObject({ alt, aiMetadataEnabled: false, mimeType: "image/png" });
      expect(await db.select().from(files).where(eq(files.id, record.id)).get()).toMatchObject({
        alt,
        aiMetadataEnabled: false,
      });
      expect(scheduleAiJob).not.toHaveBeenCalled();
      const served = await app.request(record.url, {}, env);
      expect(new TextDecoder().decode(await served.arrayBuffer())).toBe("image bytes");
    }
  });

  it("preserves AI defaults, accepts explicit settings, and rejects conflicts and unsupported media", async () => {
    const { upload, scheduleAiJob } = await fixture();
    scheduleAiJob.mockClear();
    expect(await (await upload()).json()).toMatchObject({ aiMetadataEnabled: null });
    expect(scheduleAiJob).toHaveBeenCalledOnce();
    expect(await (await upload({ aiMetadataEnabled: "true" })).json()).toMatchObject({
      aiMetadataEnabled: true,
    });
    expect(await (await upload({ aiMetadataEnabled: "false" })).json()).toMatchObject({
      aiMetadataEnabled: false,
    });
    expect((await upload({ alt: "", aiMetadataEnabled: "true" })).status).toBe(400);
    expect((await upload({ aiMetadataEnabled: "on" })).status).toBe(400);
    expect((await upload({ aiMetadataEnabled: "true" }, "application/pdf")).status).toBe(400);
    expect(await (await upload({}, "application/pdf")).json()).toMatchObject({
      aiMetadataEnabled: false,
    });
  });

  it("updates metadata atomically and enforces project, environment and membership boundaries", async () => {
    const { upload, ctx, db, project, outsiderUser, scheduleAiJob } = await fixture();
    const record = await (await upload()).json<typeof files.$inferSelect>();
    const target = { projectId: project.id, id: record.id };
    expect(await updateFile(ctx, { ...target, alt: "Manual" })).toMatchObject({
      alt: "Manual",
      aiMetadataEnabled: false,
    });
    await expect(
      updateFile(ctx, { ...target, alt: "Conflict", aiMetadataEnabled: true }),
    ).rejects.toThrow();
    await expect(updateFile(ctx, target)).rejects.toThrow();
    expect(await getProjectFile(ctx, target)).toMatchObject({
      alt: "Manual",
      aiMetadataEnabled: false,
    });
    expect(await listFiles(ctx, { projectId: project.id })).toHaveLength(1);
    const dev = { ...ctx, environmentName: `dev:${ctx.user!.email}` };
    await db.insert(environments).values({
      projectId: project.id,
      name: dev.environmentName,
      type: "development",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await expect(getProjectFile(dev, target)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updateFile(dev, { ...target, alt: "Wrong environment" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await listFiles(dev, { projectId: project.id })).toEqual([]);
    await expect(
      getProjectFile(createServiceContext(db, outsiderUser), target),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const other = await fixture();
    await expect(
      getProjectFile(other.ctx, { ...target, projectId: other.project.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    scheduleAiJob.mockClear();
    expect(await updateFile(ctx, { ...target, aiMetadataEnabled: true })).toMatchObject({
      aiMetadataEnabled: true,
      alt: "Manual",
    });
    expect(scheduleAiJob).toHaveBeenCalledOnce();
    expect(await updateFile(ctx, { ...target, alt: "" })).toMatchObject({
      alt: "",
      aiMetadataEnabled: false,
    });
  });

  it("exposes file operations through the shared agent tool dispatcher", async () => {
    const { upload, ctx, project } = await fixture();
    const file = await (await upload({ alt: "Original" })).json<typeof files.$inferSelect>();
    const invoke = (name: string, args: unknown) =>
      callTool(ctx, { projectId: project.id, name, arguments: args });
    expect(await invoke("listFiles", {})).toMatchObject({ ok: true, result: [{ id: file.id }] });
    expect(await invoke("getFile", { id: file.id })).toMatchObject({
      ok: true,
      result: { id: file.id, alt: "Original" },
    });
    expect(await invoke("updateFile", { id: file.id, alt: "" })).toMatchObject({
      ok: true,
      result: { alt: "", aiMetadataEnabled: false },
    });
    expect(await invoke("updateFile", { id: file.id, filename: "dummy-hero.png" })).toMatchObject({
      ok: true,
      result: {
        id: file.id,
        filename: "dummy-hero.png",
        alt: "",
        aiMetadataEnabled: false,
        url: file.url,
        blobId: file.blobId,
      },
    });
    for (const filename of ["", " ", "../hero.png", ".", "..", "bad\u0000name"]) {
      expect(await invoke("updateFile", { id: file.id, filename })).toMatchObject({ ok: false });
    }
    expect(
      await invoke("updateFile", { id: file.id, alt: "Manual", aiMetadataEnabled: true }),
    ).toMatchObject({ ok: false });
  });

  it("replaces bytes and metadata together while keeping references and isolating environments", async () => {
    const { upload, ctx, db, project, layout, app, scheduleAiJob } = await fixture();
    const original = await (
      await upload({ alt: "Original alt" })
    ).json<typeof files.$inferSelect>();
    const now = Date.now();
    const block = await db
      .insert(blocks)
      .values({
        layoutId: layout.id,
        type: "hero",
        content: { image: { _fileId: original.id }, html: `<img src="${original.url}">` },
        position: "a0",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    const item = await db
      .insert(repeatableItems)
      .values({
        blockId: block.id,
        fieldName: "images",
        content: { image: { _fileId: original.id }, url: original.url },
        position: "a0",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    const dev = await db
      .insert(environments)
      .values({
        projectId: project.id,
        name: "dev:other@example.com",
        type: "development",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    const devLayout = await db
      .insert(layouts)
      .values({
        projectId: project.id,
        environmentId: dev.id,
        layoutId: "default",
        createdAt: now,
        updatedAt: now,
        contentUpdatedAt: now,
      })
      .returning()
      .get();
    const devBlock = await db
      .insert(blocks)
      .values({
        layoutId: devLayout.id,
        type: "hero",
        content: { url: original.url },
        position: "a0",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    // Simulate environment replication sharing the same R2 object.
    const { id: _id, ...copy } = original;
    await db.insert(files).values({ ...copy, environmentId: dev.id });
    scheduleAiJob.mockClear();
    const response = await upload(
      { alt: "New alt" },
      "image/webp",
      "replacement.webp",
      original.id,
      "new bytes",
    );
    expect(response.status).toBe(200);
    const replaced = await response.json<typeof files.$inferSelect>();
    expect(replaced).toMatchObject({
      id: original.id,
      filename: "replacement.webp",
      alt: "New alt",
      aiMetadataEnabled: false,
      mimeType: "image/webp",
      size: 9,
      createdAt: original.createdAt,
    });
    expect(replaced.url).not.toBe(original.url);
    expect(scheduleAiJob).not.toHaveBeenCalled();
    expect(await listFiles(ctx, { projectId: project.id })).toHaveLength(1);
    expect(await db.select().from(blocks).where(eq(blocks.id, block.id)).get()).toMatchObject({
      content: { image: { _fileId: original.id }, html: `<img src="${replaced.url}">` },
    });
    expect(
      await db.select().from(repeatableItems).where(eq(repeatableItems.id, item.id)).get(),
    ).toMatchObject({
      content: { image: { _fileId: original.id }, url: replaced.url },
    });
    expect(await db.select().from(blocks).where(eq(blocks.id, devBlock.id)).get()).toMatchObject({
      content: { url: original.url },
    });
    expect(await ctx.env.FILES_BUCKET.head(original.blobId)).not.toBeNull();
    const served = await app.request(replaced.url, {}, env);
    expect(new TextDecoder().decode(await served.arrayBuffer())).toBe("new bytes");
    // The prior AI snapshot must not overwrite the replacement's explicit metadata.
    await saveGeneratedFileMetadata(db, original, { alt: "Stale", filename: "stale" });
    expect(await getProjectFile(ctx, { projectId: project.id, id: original.id })).toMatchObject({
      alt: "New alt",
      filename: "replacement.webp",
    });
  });

  it("preserves omitted metadata, schedules only the target, and removes unshared old blobs", async () => {
    const { upload, ctx, project, scheduleAiJob } = await fixture();
    const original = await (await upload({ alt: "Keep this" })).json<typeof files.$inferSelect>();
    const target = { id: original.id, projectId: project.id };
    await updateFile(ctx, { ...target, aiMetadataEnabled: true });
    scheduleAiJob.mockClear();
    const replacement = await (
      await upload({}, "image/webp", "new.webp", original.id)
    ).json<typeof files.$inferSelect>();
    expect(replacement).toMatchObject({
      id: original.id,
      alt: "Keep this",
      aiMetadataEnabled: true,
      filename: "new.webp",
    });
    expect(scheduleAiJob).toHaveBeenCalledOnce();
    const scheduled = JSON.parse(scheduleAiJob.mock.calls[0]![1].body);
    expect(scheduled).toMatchObject({ entityId: original.id, type: "fileMetadata" });
    expect(await ctx.env.FILES_BUCKET.head(original.blobId)).toBeNull();
    scheduleAiJob.mockClear();
    // AI preferences persist for non-raster replacements, but generation is skipped.
    expect(
      await (await upload({}, "application/pdf", "new.pdf", original.id)).json(),
    ).toMatchObject({ alt: "Keep this", aiMetadataEnabled: true });
    expect(scheduleAiJob).not.toHaveBeenCalled();
    expect(
      await (await upload({ alt: "" }, "image/png", "empty-alt.png", original.id)).json(),
    ).toMatchObject({ alt: "", aiMetadataEnabled: false });
  });

  it("rejects invalid replacement metadata and out-of-scope targets without storing uploads", async () => {
    const { upload, ctx, db, project } = await fixture();
    const original = await (await upload({ alt: "Original" })).json<typeof files.$inferSelect>();
    const before = await ctx.env.FILES_BUCKET.list({ prefix: `${project.id}/` });
    expect(
      (
        await upload(
          { alt: "Manual", aiMetadataEnabled: "true" },
          "image/png",
          "bad.png",
          original.id,
        )
      ).status,
    ).toBe(400);
    expect(
      (await upload({ aiMetadataEnabled: "true" }, "application/pdf", "bad.pdf", original.id))
        .status,
    ).toBe(400);
    expect((await upload({}, "image/png", "missing.png", 999999)).status).toBe(404);
    const other = await fixture();
    const otherFile = await (await other.upload()).json<typeof files.$inferSelect>();
    expect((await upload({}, "image/png", "other.png", otherFile.id)).status).toBe(404);
    expect(
      (
        await upload(
          { projectId: String(other.project.id) },
          "image/png",
          "other.png",
          otherFile.id,
        )
      ).status,
    ).toBe(403);
    const dev = await db
      .insert(environments)
      .values({
        projectId: project.id,
        name: "dev:replace@example.com",
        type: "development",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .returning()
      .get();
    const { id: _id, ...copy } = original;
    const devFile = await db
      .insert(files)
      .values({ ...copy, environmentId: dev.id })
      .returning()
      .get();
    expect((await upload({}, "image/png", "dev.png", devFile.id)).status).toBe(404);
    expect((await ctx.env.FILES_BUCKET.list({ prefix: `${project.id}/` })).objects).toEqual(
      before.objects,
    );
    expect(await getProjectFile(ctx, { projectId: project.id, id: original.id })).toEqual(original);
  });

  it("rolls back replacement and metadata on database failure and cleans up the new binary", async () => {
    const { upload, ctx, db, project, layout } = await fixture();
    const original = await (await upload({ alt: "Original" })).json<typeof files.$inferSelect>();
    const block = await db
      .insert(blocks)
      .values({
        layoutId: layout.id,
        type: "hero",
        content: { url: original.url },
        position: "a0",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .returning()
      .get();
    const triggerName = `fail_replace_${block.id}`;
    await db.run(
      sql.raw(
        `CREATE TRIGGER ${triggerName} BEFORE UPDATE ON blocks WHEN OLD.id = ${block.id} BEGIN SELECT RAISE(ABORT, 'test rollback'); END`,
      ),
    );
    const before = await ctx.env.FILES_BUCKET.list({ prefix: `${project.id}/` });
    try {
      expect(
        (await upload({ alt: "Should roll back" }, "image/webp", "failed.webp", original.id))
          .status,
      ).toBe(500);
      expect(await getProjectFile(ctx, { projectId: project.id, id: original.id })).toEqual(
        original,
      );
      expect(await db.select().from(blocks).where(eq(blocks.id, block.id)).get()).toEqual(block);
      expect((await ctx.env.FILES_BUCKET.list({ prefix: `${project.id}/` })).objects).toEqual(
        before.objects,
      );
    } finally {
      await db.run(sql.raw(`DROP TRIGGER ${triggerName}`));
    }
  });

  it("keeps the existing Studio replacement API compatible and consumes its temporary row", async () => {
    const { upload, ctx, db, project } = await fixture();
    const original = await (
      await upload({ alt: "Keep original alt" })
    ).json<typeof files.$inferSelect>();
    const incoming = await (
      await upload({ alt: "Temporary alt" }, "image/webp", "new.webp")
    ).json<typeof files.$inferSelect>();
    const pending: Promise<unknown>[] = [];
    expect(
      await replaceFile(
        {
          ...ctx,
          waitUntil: (promise) => {
            pending.push(promise);
          },
        },
        {
          id: original.id,
          newFileId: incoming.id,
        },
      ),
    ).toEqual({ replaced: true });
    await Promise.all(pending);
    expect(await getProjectFile(ctx, { projectId: project.id, id: original.id })).toMatchObject({
      id: original.id,
      blobId: incoming.blobId,
      url: incoming.url,
      filename: "new.webp",
      alt: "Keep original alt",
      aiMetadataEnabled: false,
    });
    expect(await db.select().from(files).where(eq(files.id, incoming.id)).get()).toBeUndefined();
    expect(await ctx.env.FILES_BUCKET.head(original.blobId)).toBeNull();
    expect(await ctx.env.FILES_BUCKET.head(incoming.blobId)).not.toBeNull();
  });

  it("does not allow an in-flight AI result to overwrite a manual edit", async () => {
    const { upload, ctx, db, project } = await fixture();
    const record = await (await upload()).json<typeof files.$inferSelect>();
    await updateFile(ctx, { projectId: project.id, id: record.id, alt: "Keep this" });
    const generated = { filename: "ai-name", alt: "Stale AI description" };
    await saveGeneratedFileMetadata(db, record, generated);
    expect(await getProjectFile(ctx, { projectId: project.id, id: record.id })).toMatchObject({
      alt: "Keep this",
      filename: "hero.png",
    });
    // Even re-enabling AI must not let a result from the old snapshot win.
    await updateFile(ctx, { projectId: project.id, id: record.id, aiMetadataEnabled: true });
    await saveGeneratedFileMetadata(db, record, generated);
    const current = await getProjectFile(ctx, { projectId: project.id, id: record.id });
    expect(current).toMatchObject({ alt: "Keep this", filename: "hero.png" });
    await saveGeneratedFileMetadata(db, current, { filename: "fresh", alt: "Fresh result" });
    expect(await getProjectFile(ctx, { projectId: project.id, id: record.id })).toMatchObject({
      alt: "Fresh result",
      filename: "fresh",
    });
  });
});
