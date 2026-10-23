/** A revision's ID: a UUIDv7. */
export type RevisionId = string;

/** A build error, where the build log locates it. A line of 0 is one it doesn't locate. */
export type BuildError = {
  file: string;
  line: number;
  column: number;
  message: string;
  frame: string;
};
export type TypeCheckError = { file: string; line: number; code: string; message: string };
export type LintError = { file: string; line: number; rule: string; message: string };

/**
 * What the agent's `build` answers (decided in #553): whether its changes built, the revision a
 * passing build committed, and what failed. `truncated` has each capped list's total.
 */
export type BuildResult = {
  ok: boolean;
  revision?: RevisionId;
  build: BuildError[];
  types: TypeCheckError[];
  lint: LintError[];
  truncated?: { build?: number; types?: number; lint?: number };
};

/** How many of each kind of error a result lists, at most. */
export const ERRORS_SHOWN = 30;
