/**
 * One build serves under any URL prefix: Live at `/`, a revision's preview at
 * `/_camox/r/<revisionId>/`. Whatever loads the server bundle sets this global first, never per
 * request: the bundle collects its asset URLs when it loads. Unset, assets are under `/`.
 */
export const ASSET_PREFIX_GLOBAL = "__CAMOX_ASSET_PREFIX__";

/** The prefix the server build's assets are under, ending with `/`. */
export function assetPrefix(): string {
  return (
    ((globalThis as Record<string, unknown>)[ASSET_PREFIX_GLOBAL] as string | undefined) ?? "/"
  );
}
