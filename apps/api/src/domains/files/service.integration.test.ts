import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { createProjectFixture, createServiceContext } from "../../../test/fixtures";
import { runService } from "../../lib/run-service";
import { blocks, environments, files, layouts, repeatableItems } from "../../schema";
import type { AppEnv } from "../../types";
import { callTool } from "../agent/service";
import { fileHonoRoutes } from "./routes";
import {
  deleteFile,
  saveGeneratedFileMetadata,
  getProjectFile,
  listFiles,
  replaceFile,
  updateFile,
} from "./service";

async function fixture(media?: MediaBinding) {
  const fixture = await createProjectFixture(crypto.randomUUID());
  const scheduleAiJob = vi.fn().mockResolvedValue(new Response(null));
  const baseContext = createServiceContext(fixture.db, fixture.memberUser);
  const bindings = {
    ...baseContext.env,
    MEDIA: media,
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
    contents: string | Uint8Array = "image bytes",
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

  it("supports byte ranges and HEAD for video playback on the same file URL", async () => {
    const { upload, app, ctx } = await fixture();
    const file = await (
      await upload({}, "video/mp4", "clip.mp4", undefined, "0123456789")
    ).json<typeof files.$inferSelect>();
    const partial = await app.request(file.url, { headers: { Range: "bytes=2-5" } }, ctx.env);
    expect(partial.status).toBe(206);
    expect(partial.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(partial.headers.get("accept-ranges")).toBe("bytes");
    expect(new TextDecoder().decode(await partial.arrayBuffer())).toBe("2345");
    const suffix = await app.request(file.url, { headers: { Range: "bytes=-3" } }, ctx.env);
    expect(new TextDecoder().decode(await suffix.arrayBuffer())).toBe("789");
    const head = await app.request(file.url, { method: "HEAD" }, ctx.env);
    expect(head.headers.get("content-length")).toBe("10");
    expect(await head.text()).toBe("");
    const invalid = await app.request(file.url, { headers: { Range: "bytes=10-" } }, ctx.env);
    expect(invalid.status).toBe(416);
    expect(invalid.headers.get("content-range")).toBe("bytes */10");
  });

  it("publishes a smaller video rendition before returning the file and deletes both blobs", async () => {
    const frame = (type: string, payload: Uint8Array) => {
      const bytes = new Uint8Array(payload.length + 8);
      new DataView(bytes.buffer).setUint32(0, bytes.length);
      bytes.set(new TextEncoder().encode(type), 4);
      bytes.set(payload, 8);
      return bytes;
    };
    const movie = new Uint8Array(20);
    new DataView(movie.buffer).setUint32(12, 1000);
    new DataView(movie.buffer).setUint32(16, 30_000);
    const track = new Uint8Array(8);
    new DataView(track.buffer).setUint32(0, 1280 * 65536);
    new DataView(track.buffer).setUint32(4, 720 * 65536);
    const video = (size: number) =>
      new Uint8Array([
        ...frame("ftyp", new Uint8Array(4)),
        ...frame("mdat", new Uint8Array(size)),
        ...frame(
          "moov",
          new Uint8Array([...frame("mvhd", movie), ...frame("trak", frame("tkhd", track))]),
        ),
      ]);
    const original = video(1024 * 1024);
    const rendition = video(100_000);
    const transform = vi.fn().mockReturnValue({
      output: vi.fn().mockReturnValue({
        response: vi.fn().mockResolvedValue(new Response(rendition)),
      }),
    });
    const input = vi.fn().mockReturnValue({
      transform,
    });
    const { upload, app, ctx, project } = await fixture({ input } as unknown as MediaBinding);
    const response = await upload({}, "video/mp4", "clip.mp4", undefined, original);
    expect(response.status).toBe(201);
    const file = await response.json<typeof files.$inferSelect>();
    expect(file).toMatchObject({ size: original.length, optimizedSize: rendition.length });
    expect(file.url).toContain(`${file.blobId}.optimized.mp4`);
    expect(input).toHaveBeenCalledOnce();
    expect(transform).toHaveBeenCalledWith({ width: 1280, height: 720, fit: "scale-down" });
    expect((await app.request(file.url, {}, ctx.env)).headers.get("content-type")).toBe(
      "video/mp4",
    );
    expect((await app.request(file.url, {}, ctx.env)).headers.get("content-length")).toBe(
      String(rendition.length),
    );
    expect((await ctx.env.FILES_BUCKET.head(file.blobId))?.size).toBe(original.length);
    await runService(deleteFile(ctx, { id: file.id }));
    expect((await ctx.env.FILES_BUCKET.list({ prefix: `${project.id}/` })).objects).toEqual([]);
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
    expect(await runService(updateFile(ctx, { ...target, alt: "Manual" }))).toMatchObject({
      alt: "Manual",
      aiMetadataEnabled: false,
    });
    await expect(
      runService(updateFile(ctx, { ...target, alt: "Conflict", aiMetadataEnabled: true })),
    ).rejects.toThrow();
    await expect(runService(updateFile(ctx, target))).rejects.toThrow();
    expect(await runService(getProjectFile(ctx, target))).toMatchObject({
      alt: "Manual",
      aiMetadataEnabled: false,
    });
    expect(await runService(listFiles(ctx, { projectId: project.id }))).toHaveLength(1);
    const dev = { ...ctx, environmentName: `dev:${ctx.user!.email}` };
    await db.insert(environments).values({
      projectId: project.id,
      name: dev.environmentName,
      type: "development",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await expect(runService(getProjectFile(dev, target))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      runService(updateFile(dev, { ...target, alt: "Wrong environment" })),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await runService(listFiles(dev, { projectId: project.id }))).toEqual([]);
    await expect(
      runService(getProjectFile(createServiceContext(db, outsiderUser), target)),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const other = await fixture();
    await expect(
      runService(getProjectFile(other.ctx, { ...target, projectId: other.project.id })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    scheduleAiJob.mockClear();
    expect(await runService(updateFile(ctx, { ...target, aiMetadataEnabled: true }))).toMatchObject(
      {
        aiMetadataEnabled: true,
        alt: "Manual",
      },
    );
    expect(scheduleAiJob).toHaveBeenCalledOnce();
    expect(await runService(updateFile(ctx, { ...target, alt: "" }))).toMatchObject({
      alt: "",
      aiMetadataEnabled: false,
    });
  });

  it("exposes file operations through the shared agent tool dispatcher", async () => {
    const { upload, ctx, project } = await fixture();
    const file = await (await upload({ alt: "Original" })).json<typeof files.$inferSelect>();
    const invoke = (name: string, args: unknown) =>
      runService(callTool(ctx, { projectId: project.id, name, arguments: args }));
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
    expect(await runService(listFiles(ctx, { projectId: project.id }))).toHaveLength(1);
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
    await runService(saveGeneratedFileMetadata(db, original, { alt: "Stale", filename: "stale" }));
    expect(
      await runService(getProjectFile(ctx, { projectId: project.id, id: original.id })),
    ).toMatchObject({
      alt: "New alt",
      filename: "replacement.webp",
    });
  });

  it("preserves omitted metadata, schedules only the target, and removes unshared old blobs", async () => {
    const { upload, ctx, project, scheduleAiJob } = await fixture();
    const original = await (await upload({ alt: "Keep this" })).json<typeof files.$inferSelect>();
    const target = { id: original.id, projectId: project.id };
    await runService(updateFile(ctx, { ...target, aiMetadataEnabled: true }));
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
    expect(
      await runService(getProjectFile(ctx, { projectId: project.id, id: original.id })),
    ).toEqual(original);
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
      expect(
        await runService(getProjectFile(ctx, { projectId: project.id, id: original.id })),
      ).toEqual(original);
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
      await runService(
        replaceFile(
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
      ),
    ).toEqual({ replaced: true });
    await Promise.all(pending);
    expect(
      await runService(getProjectFile(ctx, { projectId: project.id, id: original.id })),
    ).toMatchObject({
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
    await runService(updateFile(ctx, { projectId: project.id, id: record.id, alt: "Keep this" }));
    const generated = { filename: "ai-name", alt: "Stale AI description" };
    await runService(saveGeneratedFileMetadata(db, record, generated));
    expect(
      await runService(getProjectFile(ctx, { projectId: project.id, id: record.id })),
    ).toMatchObject({
      alt: "Keep this",
      filename: "hero.png",
    });
    // Even re-enabling AI must not let a result from the old snapshot win.
    await runService(
      updateFile(ctx, { projectId: project.id, id: record.id, aiMetadataEnabled: true }),
    );
    await runService(saveGeneratedFileMetadata(db, record, generated));
    const current = await runService(getProjectFile(ctx, { projectId: project.id, id: record.id }));
    expect(current).toMatchObject({ alt: "Keep this", filename: "hero.png" });
    await runService(
      saveGeneratedFileMetadata(db, current, { filename: "fresh", alt: "Fresh result" }),
    );
    expect(
      await runService(getProjectFile(ctx, { projectId: project.id, id: record.id })),
    ).toMatchObject({
      alt: "Fresh result",
      filename: "fresh",
    });
  });
});
