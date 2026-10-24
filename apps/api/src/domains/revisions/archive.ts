import type { Bindings } from "../../types";

// A revision's build is stored in `REVISION_BUILDS` as one gzipped tar archive of the website's
// `dist/` directory as `vp build` leaves it: `dist/client/` (the client assets) and the server
// build's directory with its `wrangler.json`. Prewarming a revision has dispatch store its client
// assets too, one object each, which its asset prefix serves.

type Keyed = { project: string; draft: string };

/** Where a draft's builds are, by its project's Project ID and the draft's ID. */
const draftPrefix = ({ project, draft }: Keyed) => `${project}/${draft}/`;

/** Where a revision's build is stored. */
export const revisionArchiveKey = ({ revision, ...draft }: Keyed & { revision: string }) =>
  `${draftPrefix(draft)}${revision}.tar.gz`;

/**
 * Where dispatch stores a prewarmed revision's client assets. Mirrored from `revisionAssetKey` in
 * apps/dispatch/src/revisions.ts: keep the two in sync.
 */
const revisionAssetsPrefix = ({ project, revision }: { project: string; revision: string }) =>
  `${project}/revisions/${revision}/`;

/** The revision a key under a draft's builds is the archive of, or null for another object. */
function revisionArchivedAt(key: string, draft: Keyed) {
  const prefix = draftPrefix(draft);
  return key.startsWith(prefix) && key.endsWith(".tar.gz")
    ? key.slice(prefix.length, -".tar.gz".length)
    : null;
}

/** Deletes every object whose key starts with `prefix`, returning their keys. */
async function deleteUnder(env: Pick<Bindings, "REVISION_BUILDS">, prefix: string) {
  const deleted: string[] = [];
  let cursor: string | undefined;
  do {
    const listed = await env.REVISION_BUILDS.list({ prefix, cursor });
    if (listed.objects.length > 0) {
      await env.REVISION_BUILDS.delete(listed.objects.map(({ key }) => key));
    }
    deleted.push(...listed.objects.map(({ key }) => key));
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return deleted;
}

/** Deletes a revision's build and its prewarmed client assets. */
export async function deleteRevisionBuild(
  env: Pick<Bindings, "REVISION_BUILDS">,
  revision: Keyed & { revision: string },
) {
  await env.REVISION_BUILDS.delete(revisionArchiveKey(revision));
  await deleteUnder(env, revisionAssetsPrefix(revision));
}

/** Deletes every build of a draft, with their prewarmed client assets. */
export async function deleteDraftBuilds(env: Pick<Bindings, "REVISION_BUILDS">, draft: Keyed) {
  for (const key of await deleteUnder(env, draftPrefix(draft))) {
    const revision = revisionArchivedAt(key, draft);
    if (revision)
      await deleteUnder(env, revisionAssetsPrefix({ project: draft.project, revision }));
  }
}

/** Deletes every build of a project's drafts, with their prewarmed client assets. */
export async function deleteProjectBuilds(env: Pick<Bindings, "REVISION_BUILDS">, project: string) {
  await deleteUnder(env, `${project}/`);
}
