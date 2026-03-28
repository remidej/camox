import { Hono } from "hono";

import { requireOrg } from "./authorization";
import { createDb } from "./db";
import { authRoutes, createAuth } from "./features/auth";
import { blockDefinitionRoutes } from "./features/block-definitions";
import { blockRoutes } from "./features/blocks";
import { fileRoutes } from "./features/files";
import { layoutRoutes } from "./features/layouts";
import { pageRoutes } from "./features/pages";
import { projectRoutes } from "./features/projects";
import { repeatableItemRoutes } from "./features/repeatable-items";
import { seedRoutes } from "./features/seed";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>()
  // Inject db into every request
  .use("*", async (c, next) => {
    c.set("db", createDb(c.env.DB));
    await next();
  })
  // Auth routes (unauthenticated)
  .route("/api/auth", authRoutes)
  // Seed route (dev only, unauthenticated)
  .route("/seed", seedRoutes)
  // Session middleware — populates c.var.user/session for all subsequent routes
  .use("*", async (c, next) => {
    const auth = createAuth(c.var.db, c.env);
    const session = await auth.api.getSession({ headers: c.req.raw.headers });

    if (!session) {
      c.set("user", null);
      c.set("session", null);
      await next();
      return;
    }

    c.set("user", session.user);
    c.set("session", session.session);
    await next();
  })
  // All content routes require authentication
  .use("/projects/*", requireOrg)
  .use("/pages/*", requireOrg)
  .use("/blocks/*", requireOrg)
  .use("/layouts/*", requireOrg)
  .use("/files/*", requireOrg)
  .use("/repeatable-items/*", requireOrg)
  .use("/block-definitions/*", requireOrg)
  .route("/projects", projectRoutes)
  .route("/pages", pageRoutes)
  .route("/blocks", blockRoutes)
  .route("/layouts", layoutRoutes)
  .route("/files", fileRoutes)
  .route("/repeatable-items", repeatableItemRoutes)
  .route("/block-definitions", blockDefinitionRoutes);

export type AppType = typeof app;
export default app;
