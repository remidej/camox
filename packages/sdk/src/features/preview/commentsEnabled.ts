/** Comments follow the experimental-features flag in both client and SSR builds. */
export function areCommentsEnabled(): boolean {
  return (
    typeof __CAMOX_ENABLE_EXPERIMENTAL_FEATURES__ !== "undefined" &&
    __CAMOX_ENABLE_EXPERIMENTAL_FEATURES__
  );
}
