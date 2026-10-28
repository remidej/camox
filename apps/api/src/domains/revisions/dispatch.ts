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
  /**
   * Readies a revision before its draft's viewers are told of it, reading its build once, from
   * `archive` when the API sends it, as it does while it stores it, or else from R2:
   * dispatch serves its client assets from then on, and has loaded and rendered it once. Returns
   * its Definition Set (JSON, not yet checked), with what each part took, for the API's timing
   * logs.
   */
  prepare(revision: RevisionToLoad, archive?: Uint8Array): Promise<PreparedRevision>;
};

/**
 * What preparing a revision took: reading its build, then, at once, storing its client assets
 * (how many) and reading its Definition Set, then the first render. Mirrored in
 * apps/dispatch/src/revisions.ts: keep the two in sync.
 */
export type PrepareTimings = {
  assets: number;
  readMs: number;
  assetsMs: number;
  definitionSetMs: number;
  renderMs: number;
};

/** A prepared revision's Definition Set, with what preparing it took. */
export type PreparedRevision = PrepareTimings & { definitionSet: unknown };
