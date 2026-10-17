import {
  DRAFT_CREATE_HEADER,
  DRAFT_HEADER,
  LIVE_READ_ONLY_ERROR,
  isContentWrite,
} from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { call, ORPCError, type AnyProcedure } from "@orpc/server";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vite-plus/test";

import { createProjectFixture, createRpcContext } from "../../../test/fixtures";
import { router } from "../../router";
import { drafts } from "../../schema";
import type { AppEnv } from "../../types";
import { fileHonoRoutes } from "../files/routes";

const { broadcastInvalidation } = vi.hoisted(() => {
  // Modules loaded by earlier test files would keep the real broadcaster.
  vi.resetModules();
  return { broadcastInvalidation: vi.fn() };
});
vi.mock("../../lib/broadcast-invalidation", () => ({ broadcastInvalidation }));

async function fixture() {
  const base = await createProjectFixture(`live-read-only-${crypto.randomUUID()}`);
  const member = (headers: Record<string, string> = {}) => ({
    context: createRpcContext(base.db, base.memberUser, headers),
  });
  return { ...base, member };
}

/** The code a procedure fails with when called by a member on Live with an empty input. */
async function failureOnLive(procedure: AnyProcedure, f: Awaited<ReturnType<typeof fixture>>) {
  try {
    await call(procedure, {}, f.member());
    return undefined;
  } catch (error) {
    return error instanceof ORPCError ? error.code : String(error);
  }
}

const procedurePaths = Object.entries(router).flatMap(([routerName, procedures]) =>
  Object.keys(procedures).map((name) => [routerName, name] as const),
);

describe("Live is read-only", () => {
  it.each(procedurePaths.filter((path) => isContentWrite(path)))(
    "%s.%s rejects a member's request naming no draft",
    async (routerName, name) => {
      const f = await fixture();
      const procedure = (router as unknown as Record<string, Record<string, AnyProcedure>>)[
        routerName
      ]![name]!;
      expect(await failureOnLive(procedure, f)).toBe(LIVE_READ_ONLY_ERROR);
    },
  );

  it.each(procedurePaths.filter((path) => !isContentWrite(path)))(
    "%s.%s, which writes no content, isn't rejected for naming no draft",
    async (routerName, name) => {
      const f = await fixture();
      const procedure = (router as unknown as Record<string, Record<string, AnyProcedure>>)[
        routerName
      ]![name]!;
      expect(await failureOnLive(procedure, f)).not.toBe(LIVE_READ_ONLY_ERROR);
    },
  );

  it("AI tools that write content reject a session naming no draft, and others don't", async () => {
    const f = await fixture();
    const projectId = f.project.id;
    const tools = await call(router.agent.listTools, { projectId }, f.member());

    const rejected: string[] = [];
    for (const { name } of tools) {
      const outcome = await call(
        router.agent.callTool,
        { projectId, name, arguments: {} },
        f.member(),
      )
        .then(() => undefined)
        .catch((error: unknown) => (error instanceof ORPCError ? error.code : String(error)));
      if (outcome === LIVE_READ_ONLY_ERROR) rejected.push(name);
    }

    expect(rejected.sort()).toEqual(
      [
        "createBlock",
        "editBlock",
        "moveBlock",
        "deleteBlock",
        "createCollectionRecord",
        "editCollectionRecord",
        "deleteCollectionRecord",
        "updateFile",
        "createPage",
        "updatePage",
        "setPageLayout",
        "setPageSeo",
        "deletePage",
        "publishDraft",
        "discardDraft",
      ].sort(),
    );
  });

  it("a content write naming a draft goes through, starting it", async () => {
    const f = await fixture();
    const draftId = generateUuidv7();
    const page = await call(
      router.pages.create,
      { projectId: f.project.id, pathSegment: "about", layoutId: f.layout.layoutId },
      f.member({ [DRAFT_HEADER]: draftId, [DRAFT_CREATE_HEADER]: "1" }),
    );

    expect(page.fullPath).toBe("/about");
    expect(await f.db.select().from(drafts).where(eq(drafts.id, draftId)).get()).toBeDefined();
  });

  it("an upload or a replacement naming no draft is rejected and stores nothing", async () => {
    const f = await fixture();
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => {
      c.set("db", f.db);
      c.set("user", f.memberUser);
      await next();
    });
    app.route("/files", fileHonoRoutes);
    const env = createRpcContext(f.db, f.memberUser).env;
    const before = await env.FILES_BUCKET.list({ prefix: `${f.project.id}/` });

    for (const path of ["/files/upload", `/files/${generateUuidv7()}/content`]) {
      const body = new FormData();
      body.set("file", new File(["bytes"], "hero.png", { type: "image/png" }));
      body.set("projectId", String(f.project.id));
      const execution = createExecutionContext();
      const response = await app.request(
        `http://localhost${path}`,
        { method: "POST", body },
        env,
        execution,
      );
      await waitOnExecutionContext(execution);

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: LIVE_READ_ONLY_ERROR });
    }
    const after = await env.FILES_BUCKET.list({ prefix: `${f.project.id}/` });
    expect(after.objects.length).toBe(before.objects.length);
  });
});
