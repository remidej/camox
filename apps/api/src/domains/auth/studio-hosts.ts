import { and, eq } from "drizzle-orm";

import type { Database } from "../../db";
import { isLoopbackHostname } from "../../lib/loopback";
import { member, projects } from "../../schema";

// Mirror of `resolveHost()` in apps/dispatch/src/worker.ts, which serves these hosts: kept
// duplicated because the API and the dispatch Worker share no package. Keep the two in sync.
const PROJECTS_DOMAIN = ".camox.site";

/**
 * The Project ID of the website dispatch serves at `hostname`: a Custom Domain's project, or a
 * `<slug>.camox.site` host's, unless that project has a Custom Domain, which dispatch redirects to.
 */
async function projectServedAt(projectSlugs: KVNamespace, hostname: string) {
  if (!hostname.endsWith(PROJECTS_DOMAIN)) return projectSlugs.get(hostname);
  const slug = hostname.slice(0, -PROJECTS_DOMAIN.length);
  // Slugs are one label, so a deeper subdomain names none, nor a Custom Domain's entry.
  if (!slug || slug.includes(".")) return null;
  const { value, metadata } = await projectSlugs.getWithMetadata<{ customDomain?: string }>(slug);
  return metadata?.customDomain ? null : value;
}

/**
 * Whether `callback` is on this computer: an http(s) loopback URL without credentials, like the
 * CLI's callback server or a dev server.
 */
export function isLocalCallback(callback: URL): boolean {
  if (callback.username || callback.password) return false;
  if (callback.protocol !== "http:" && callback.protocol !== "https:") return false;
  return isLoopbackHostname(callback.hostname);
}

/**
 * Whether the studio at `callback` may get a session for `userId`: a host dispatch serves a
 * website at (ADR 0028), for a project the user is a member of, or localhost, where developers run
 * the studio.
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

  const projectId = await projectServedAt(projectSlugs, callback.hostname);
  if (!projectId) return false;

  const membership = await db
    .select({ id: member.id })
    .from(projects)
    .innerJoin(member, eq(member.organizationId, projects.organizationId))
    .where(and(eq(projects.uuid, projectId), eq(member.userId, userId)))
    .get();
  return Boolean(membership);
}
