import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { createProjectFixture, createServiceContext } from "../../../test/fixtures";
import { environments, files } from "../../schema";
import type { AppEnv } from "../../types";
import { callTool } from "../agent/service";
import { fileHonoRoutes } from "./routes";
import { saveGeneratedFileMetadata, getProjectFile, listFiles, updateFile } from "./service";

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
  ) {
    const body = new FormData();
    body.set("file", new File(["image bytes"], filename, { type }));
    body.set("projectId", String(fixture.project.id));
    for (const [key, value] of Object.entries(metadata)) body.set(key, value);
    const execution = createExecutionContext();
    const response = await app.request(
      "http://localhost/files/upload",
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
