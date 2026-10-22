// `camox` under the root importer of a pnpm v9 lockfile:
//
//   importers:
//     .:
//       dependencies:
//         camox:
//           specifier: 0.9.1
//           version: 0.9.1(react@19.3.1)
const ROOT_CAMOX =
  /^importers:\n(?:\n| {2}.*\n)*? {2}\.:\n(?:\n| {4}.*\n)*? {6}camox:\n {8}specifier: .*\n {8}version: ([^\s(]+)/m;

/** The `camox` version a project's `pnpm-lock.yaml` installs, or null if it installs none. */
export function camoxVersionInLockfile(lockfile: string) {
  return ROOT_CAMOX.exec(lockfile.replaceAll("\r\n", "\n"))?.[1] ?? null;
}
