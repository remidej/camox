/** Opt-in prototype flag, replaced by the Camox Vite plugin in both client and SSR builds. */
export function areCommentsEnabled(): boolean {
  return typeof __CAMOX_ENABLE_COMMENTS__ !== "undefined" && __CAMOX_ENABLE_COMMENTS__;
}
