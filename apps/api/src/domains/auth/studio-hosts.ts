import { and, eq } from "drizzle-orm";

import type { Database } from "../../db";
import { member, projects } from "../../schema";

const PROJECTS_DOMAIN = ".camox.site";

function isLocalhost(hostname: string) {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "[::1]") return true;
  return /^127(?:\.\d{1,3}){3}$/.test(host);
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
  if (callback.username || callback.password) return false;
  if (isLocalhost(callback.hostname)) {
    return callback.protocol === "http:" || callback.protocol === "https:";
  }
  if (callback.protocol !== "https:" || !callback.hostname.endsWith(PROJECTS_DOMAIN)) return false;

  const slug = callback.hostname.slice(0, -PROJECTS_DOMAIN.length);
  const projectUuid = slug && (await projectSlugs.get(slug));
  if (!projectUuid) return false;

  const membership = await db
    .select({ id: member.id })
    .from(projects)
    .innerJoin(member, eq(member.organizationId, projects.organizationId))
    .where(and(eq(projects.uuid, projectUuid), eq(member.userId, userId)))
    .get();
  return Boolean(membership);
}
