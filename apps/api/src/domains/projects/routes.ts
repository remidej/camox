import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { Hono } from "hono";

import { getAuthorizedProject } from "../../authorization";
import type { Database } from "../../db";
import { record } from "../../lib/journal";
import { runService } from "../../lib/run-service";
import { authed } from "../../orpc";
import { projects } from "../../schema";
import type { AppEnv } from "../../types";
import * as service from "./service";

// Protected procedures
const list = authed
  .input(service.listProjectsInput)
  .handler(({ context, input }) => runService(service.listProjects(context, input)));

const getFirst = authed
  .input(service.getFirstProjectInput)
  .handler(({ context, input }) => runService(service.getFirstProject(context, input)));

const getBySlug = authed
  .input(service.getProjectBySlugInput)
  .handler(({ context, input }) => runService(service.getProjectBySlug(context, input)));

const getByUuid = authed
  .input(service.getProjectByUuidInput)
  .handler(({ context, input }) => runService(service.getProjectByUuid(context, input)));

const get = authed
  .input(service.getProjectInput)
  .handler(({ context, input }) => runService(service.getProject(context, input)));

const checkSlugAvailability = authed
  .input(service.checkProjectSlugAvailabilityInput)
  .handler(({ context, input }) =>
    runService(service.checkProjectSlugAvailability(context, input)),
  );

const create = authed
  .input(service.createProjectInput)
  .handler(({ context, input }) => runService(service.createProject(context, input)));

const update = authed
  .input(service.updateProjectInput)
  .handler(({ context, input }) => runService(service.updateProject(context, input)));

const updateAnalytics = authed
  .input(service.updateProjectAnalyticsInput)
  .handler(({ context, input }) => runService(service.updateProjectAnalytics(context, input)));

const deleteFn = authed
  .input(service.deleteProjectInput)
  .handler(({ context, input }) => runService(service.deleteProject(context, input)));

export const projectProcedures = {
  list,
  getFirst,
  getBySlug,
  getByUuid,
  get,
  checkSlugAvailability,
  create,
  update,
  updateAnalytics,
  delete: deleteFn,
};

// --- Hono routes (favicon binary serving + multipart upload) ---
//
// Favicons live in R2 at `favicons/${projectId}` — one per project, shared
// by Live and every draft. No `files` row (so they stay out of the project's files).
// We bump `projects.updatedAt` on writes so `?v=${updatedAt}` busts the URL.

const FAVICON_MIME_ALLOWLIST = new Set([
  "image/png",
  "image/svg+xml",
  "image/x-icon",
  "image/vnd.microsoft.icon",
]);
const FAVICON_MAX_BYTES = 500 * 1024;

// The default favicon: an outline of the Camox mark, served instead of a 404 when the request
// asks for `?default=camox`, so a project without its own favicon still shows one, both as the
// site's tab icon and in the studio. It's hollow so it reads as a slot to fill rather than the
// site's own logo. The dashboard omits the query to learn whether a favicon was uploaded.
const DEFAULT_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10 -10 211.03 211.03"><path d="M0 22.55A22.55 22.55 0 0 1 22.55 0L90.19 0A5.32 5.32 0 0 1 95.52 5.32L95.52 36.48L36.48 36.48L36.48 95.52L5.32 95.52A5.32 5.32 0 0 1 0 90.19ZM95.52 36.48L181.48 36.48A5.32 5.32 0 0 1 186.01 44.61L138.61 121.31A22.55 22.55 0 0 1 119.43 132L41.81 132A5.32 5.32 0 0 1 36.48 126.68L36.48 95.52L95.52 95.52Z" fill="none" stroke="#00BC7D" stroke-width="15" stroke-linejoin="round" transform="translate(0 29.52)"/></svg>`;

function faviconKey(projectId: number) {
  return `favicons/${projectId}`;
}

function authorizeFavicon(db: Database, projectId: number, userId: string) {
  return Effect.runPromise(
    getAuthorizedProject(db, projectId, userId).pipe(
      Effect.as({ ok: true as const }),
      Effect.catchTags({
        NotFoundError: () =>
          Effect.succeed({ ok: false as const, error: "Not found", status: 404 as const }),
        ForbiddenError: () =>
          Effect.succeed({ ok: false as const, error: "Forbidden", status: 403 as const }),
      }),
    ),
  );
}

export const faviconHonoRoutes = new Hono<AppEnv>();

function defaultFaviconResponse() {
  return new Response(DEFAULT_FAVICON_SVG, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=3600",
      "Content-Disposition": "inline",
    },
  });
}

faviconHonoRoutes.get("/default", () => defaultFaviconResponse());

faviconHonoRoutes.get("/:projectId", async (c) => {
  const projectId = Number(c.req.param("projectId"));
  if (!projectId || Number.isNaN(projectId)) {
    return c.json({ error: "Invalid projectId" }, 400);
  }

  const object = await c.env.FILES_BUCKET.get(faviconKey(projectId));
  if (!object && c.req.query("default") === "camox") return defaultFaviconResponse();
  if (!object) return c.notFound();

  const ifNoneMatch = c.req.header("If-None-Match");
  if (ifNoneMatch && ifNoneMatch === object.httpEtag) {
    return new Response(null, {
      status: 304,
      headers: {
        ETag: object.httpEtag,
        "Cache-Control": "public, max-age=3600",
      },
    });
  }

  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "Cache-Control": "public, max-age=3600",
      ETag: object.httpEtag,
      "Content-Disposition": "inline",
    },
  });
});

faviconHonoRoutes.post("/upload", async (c) => {
  if (!c.var.user) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.parseBody();
  const file = body["file"];
  const projectId = Number(body["projectId"]);

  if (!(file instanceof File)) return c.json({ error: "Missing file" }, 400);
  if (!projectId || Number.isNaN(projectId)) return c.json({ error: "Missing projectId" }, 400);

  if (!FAVICON_MIME_ALLOWLIST.has(file.type)) {
    return c.json({ error: "Unsupported file type. Use PNG, SVG, or ICO." }, 400);
  }
  if (file.size > FAVICON_MAX_BYTES) {
    return c.json({ error: "Favicon must be 500 KB or smaller." }, 413);
  }

  const access = await authorizeFavicon(c.var.db, projectId, c.var.user.id);
  if (!access.ok) return c.json({ error: access.error }, access.status);

  await c.env.FILES_BUCKET.put(faviconKey(projectId), file.stream(), {
    httpMetadata: { contentType: file.type },
  });

  const updatedAt = Date.now();
  await c.var.db.update(projects).set({ updatedAt }).where(eq(projects.id, projectId));
  await runService(record(c.var.db, { kind: "project", projectId }));

  return c.json({ updatedAt }, 200);
});

faviconHonoRoutes.delete("/:projectId", async (c) => {
  if (!c.var.user) return c.json({ error: "Unauthorized" }, 401);

  const projectId = Number(c.req.param("projectId"));
  if (!projectId || Number.isNaN(projectId)) {
    return c.json({ error: "Invalid projectId" }, 400);
  }

  const access = await authorizeFavicon(c.var.db, projectId, c.var.user.id);
  if (!access.ok) return c.json({ error: access.error }, access.status);

  await c.env.FILES_BUCKET.delete(faviconKey(projectId));
  await c.var.db.update(projects).set({ updatedAt: Date.now() }).where(eq(projects.id, projectId));
  await runService(record(c.var.db, { kind: "project", projectId }));

  return new Response(null, { status: 204 });
});
