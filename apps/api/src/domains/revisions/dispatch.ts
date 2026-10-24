// What the API asks of the dispatch Worker about revisions, through its `DISPATCH` service
// binding to dispatch's `CamoxRevisions` entrypoint (apps/dispatch/src/worker.ts), which loads a
// revision as a Dynamic Worker from its build.

/**
 * A revision, as the API names it to dispatch. Mirrored in apps/dispatch/src/revisions.ts: keep
 * the two in sync.
 */
export type RevisionToLoad = {
  /** The revision's ID, which names its Dynamic Worker. */
  revision: string;
  /** Its build in `REVISION_BUILDS`. */
  archiveKey: string;
  /** Its project's Project ID. */
  project: string;
  /** Its draft's ID. */
  draft: string;
};

/** Dispatch's `CamoxRevisions` entrypoint. */
export type Dispatch = {
  /** A revision's Definition Set, as its build's entrypoint gives it: JSON, not yet checked. */
  readDefinitionSet(revision: RevisionToLoad): Promise<unknown>;
};
