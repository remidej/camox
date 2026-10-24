/**
 * The environment that turns on the build checks only hosted projects have: the import allowlist
 * and the block ids (`HOSTED_BUILD_ENV` in packages/sdk/src/features/vite/hostedChecks.ts). Every
 * build Camox runs of a project's code sets it: revisions, releases and Upgrades.
 */
export const HOSTED_BUILD = { CAMOX_INTERNAL_HOSTED: "1" } as const;
