import { and, eq, inArray, type SQL } from "drizzle-orm";

import { createDb, type Database } from "../../db";
import { member, projects } from "../../schema";
import type { Bindings } from "../../types";
import { createAuth } from "../auth/routes";
import { verifyLookToken } from "../drafts/look-token";
import { drafts } from "../drafts/schema";
import type { RevisionToLoad } from "./dispatch";
import { revisions } from "./schema";

// What dispatch asks the API before it sends a request to a draft with code's revision (ADR
// 0023): whether the request's session, or its look token (ADR 0032), can see the draft, and which
// revision the draft previews.
// Reached through the `CamoxPreviews` entrypoint (src/worker.ts), over dispatch's `API` service
// binding.

/** Better Auth's session cookies, by the names it gives them over HTTPS and over HTTP. */
const SESSION_COOKIES = ["__Secure-better-auth.session_token", "better-auth.session_token"];

/** The session token a `Cookie` header's value holds, signed as its cookie holds it, if any. */
function sessionTokenOf(cookies: string) {
  for (const part of cookies.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (!SESSION_COOKIES.includes(part.slice(0, separator).trim())) continue;
    const value = part.slice(separator + 1).trim();
    if (value) return value;
  }
  return null;
}

/** What dispatch asks about a request: its project's Project ID, the draft it names, its session. */
export type PreviewQuestion = { project: string; draft: string; session: string };

/**
 * The revision the draft `draft` of the project `project` previews, when `session` (a `Cookie`
 * header's value, as the SDK forwards it) belongs to a member of the project's organization.
 * Null for anyone else, a draft of another project, an ended draft, and a draft that previews no
 * revision yet.
 */
export async function previewedRevision(
  env: Bindings,
  { project, draft, session }: PreviewQuestion,
): Promise<RevisionToLoad | null> {
  const token = sessionTokenOf(session);
  if (!token) return null;
  const db = createDb(env.DB);
  // The session is checked by Better Auth, as a bearer token: its cookie's name depends on the
  // origin the API is reached at, which a service binding doesn't have.
  const signedIn = await createAuth(db, env, env.DASHBOARD_URL).api.getSession({
    headers: new Headers({ authorization: `Bearer ${token}` }),
  });
  if (!signedIn) return null;
  const memberOrganizations = db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, signedIn.user.id));
  return revisionPreviewedBy(
    db,
    { project, draft },
    inArray(projects.organizationId, memberOrganizations),
  );
}

/** What dispatch asks about a look document: its project's Project ID, its draft, its look token. */
export type LookQuestion = { project: string; draft: string; token: string };

/**
 * The revision the draft `draft` of the project `project` previews, when `token` is a look token
 * Camox signed for that draft that hasn't expired. Null for any other token, a draft of another
 * project, an ended draft, and a draft that previews no revision yet, whose look document Live's
 * code serves.
 */
export async function lookedRevision(
  env: Bindings,
  { project, draft, token }: LookQuestion,
): Promise<RevisionToLoad | null> {
  const grant = await verifyLookToken(env, token);
  if (!grant || grant.draftId !== draft) return null;
  return revisionPreviewedBy(
    createDb(env.DB),
    { project, draft },
    eq(projects.id, grant.projectId),
  );
}

/**
 * The revision the draft `draft` of the project `project` previews, when its project meets
 * `allowed`, or null. The two questions differ only in who is allowed.
 */
async function revisionPreviewedBy(
  db: Database,
  { project, draft }: { project: string; draft: string },
  allowed: SQL,
): Promise<RevisionToLoad | null> {
  const previewed = await db
    .select({ revision: revisions.id, archiveKey: revisions.archiveKey })
    .from(drafts)
    .innerJoin(projects, eq(projects.id, drafts.projectId))
    .innerJoin(revisions, eq(revisions.id, drafts.previewedRevisionId))
    .where(and(eq(drafts.id, draft), eq(projects.uuid, project), allowed))
    .get();
  if (!previewed?.archiveKey) return null;
  return { revision: previewed.revision, archiveKey: previewed.archiveKey, project, draft };
}
