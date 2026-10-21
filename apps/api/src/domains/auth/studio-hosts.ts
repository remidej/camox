import { and, eq } from "drizzle-orm";

import type { Database } from "../../db";
import { isLoopbackHostname } from "../../lib/loopback";
import { member, projects } from "../../schema";

// Mirror of `projectSlug()` in apps/dispatch/src/worker.ts, which serves these hosts: kept
// duplicated because the API and the dispatch Worker share no package. Keep the two in sync.
const PROJECTS_DOMAIN = ".camox.site";

function projectSlug(hostname: string) {
  return hostname.endsWith(PROJECTS_DOMAIN) ? hostname.slice(0, -PROJECTS_DOMAIN.length) : "";
}

/**
 * Whether `callback` is on this computer: an http(s) loopback URL without credentials, like the
 * CLI's callback server, a dev server, or a site `camox preview` opens.
 */
export function isLocalCallback(callback: URL): boolean {
  if (callback.username || callback.password) return false;
  if (callback.protocol !== "http:" && callback.protocol !== "https:") return false;
  return isLoopbackHostname(callback.hostname);
}

/**
 * Whether the studio at `callback` may get a session for `userId`: a `<slug>.camox.site` host the
 * KV map knows, for a project the user is a member of, or localhost, where developers run the
 * studio.
 */
export async function isStudioHostOf(
  db: Database,
  projectSlugs: KVNamespace,
  callback: URL,
  userId: string,
): Promise<boolean> {
  if (isLocalCallback(callback)) return true;
  if (callback.username || callback.password) return false;
  // The dispatch Worker serves projects over https on the default port only.
  if (callback.protocol !== "https:" || callback.port) return false;

  const slug = projectSlug(callback.hostname);
  const projectId = slug && (await projectSlugs.get(slug));
  if (!projectId) return false;

  const membership = await db
    .select({ id: member.id })
    .from(projects)
    .innerJoin(member, eq(member.organizationId, projects.organizationId))
    .where(and(eq(projects.uuid, projectId), eq(member.userId, userId)))
    .get();
  return Boolean(membership);
}
