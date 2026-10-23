import type { Bindings } from "../../types";

// A revision's build is stored in `REVISION_BUILDS` as one gzipped tar archive of the website's
// `dist/` directory as `vp build` leaves it: `dist/client/` (the client assets) and the server
// build's directory with its `wrangler.json`.

type Keyed = { project: string; draft: string };

/** Where a draft's builds are, by its project's Project ID and the draft's ID. */
const draftPrefix = ({ project, draft }: Keyed) => `${project}/${draft}/`;

/** Where a revision's build is stored. */
export const revisionArchiveKey = ({ revision, ...draft }: Keyed & { revision: string }) =>
  `${draftPrefix(draft)}${revision}.tar.gz`;

/** Deletes every build of a draft. */
export async function deleteDraftBuilds(env: Pick<Bindings, "REVISION_BUILDS">, draft: Keyed) {
  let cursor: string | undefined;
  do {
    const listed = await env.REVISION_BUILDS.list({ prefix: draftPrefix(draft), cursor });
    if (listed.objects.length > 0) {
      await env.REVISION_BUILDS.delete(listed.objects.map(({ key }) => key));
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}
