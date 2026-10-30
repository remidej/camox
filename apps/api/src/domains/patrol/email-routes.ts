import { eq } from "drizzle-orm";
import { type Context, Hono } from "hono";

import { escapeHtml } from "../../lib/email";
import type { AppEnv } from "../../types";
import { projects } from "../projects/schema";
import { unsubscribe, verifiedUnsubscribe } from "./patrol-email";

// The unsubscribe links in emails about Live's new findings (patrol-email.ts). Opening one asks
// first, so mail scanners following links unsubscribe no one; confirming, or an inbox's one-click
// unsubscribe (RFC 8058), posts to the same link.

export const patrolEmailRoutes = new Hono<AppEnv>();

const page = (title: string, body: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;padding:48px 16px;background:#f5f5f5;color:#171717;font-family:Arial,sans-serif">
    <main style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #e5e5e5;border-radius:12px;padding:32px">
      <h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(title)}</h1>
      ${body}
    </main>
  </body>
</html>`;

/** The project an unsubscribe link names, when the API signed it and the project still exists. */
async function linked(c: Context<AppEnv>) {
  const query = await verifiedUnsubscribe(c.env, c.req.query());
  if (!query) return null;
  const project = await c.var.db
    .select({ name: projects.name })
    .from(projects)
    .where(eq(projects.id, query.projectId))
    .get();
  return project ? { ...query, projectName: project.name } : null;
}

const notFound = page("This link doesn't work", "<p>Unsubscribe from the link in your email.</p>");

patrolEmailRoutes.get("/unsubscribe", async (c) => {
  const found = await linked(c);
  if (!found) return c.html(notFound, 404);
  const what = `emails about problems Camox finds on ${found.projectName}'s website`;
  return c.html(
    page(
      "Unsubscribe",
      `<p style="line-height:24px">Stop getting ${escapeHtml(what)}?</p>
      <form method="post"><button type="submit" style="background:#171717;color:#fff;border:0;border-radius:8px;padding:12px 20px;font-size:16px;font-weight:600;cursor:pointer">Unsubscribe</button></form>`,
    ),
  );
});

patrolEmailRoutes.post("/unsubscribe", async (c) => {
  const found = await linked(c);
  if (!found) return c.html(notFound, 404);
  await unsubscribe(c.var.db, found);
  return c.html(
    page(
      "You're unsubscribed",
      `<p style="line-height:24px">You'll no longer get emails about problems Camox finds on ${escapeHtml(found.projectName)}'s website.</p>`,
    ),
  );
});
