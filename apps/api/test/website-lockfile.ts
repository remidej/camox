/**
 * A hosted website's `pnpm-lock.yaml` (pnpm v9), installing `camox` from npm with the packages
 * its SDK Bundle holds: enough for `sdkBundleName` to name the bundle. `react` changes the
 * resolution of a package the bundle holds, without changing the `camox` version.
 */
export function websiteLockfile(camoxVersion: string, { react = "19.3.1" } = {}) {
  const peers = `(react@${react})`;
  return `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      camox:
        specifier: ^${camoxVersion}
        version: ${camoxVersion}${peers}
      react:
        specifier: ^${react}
        version: ${react}
      react-dom:
        specifier: ^${react}
        version: ${react}${peers}
      '@tanstack/react-query':
        specifier: ^5.104.5
        version: 5.104.5${peers}

packages:

  camox@${camoxVersion}:
    resolution: {integrity: sha512-camox-${camoxVersion}}
    peerDependencies:
      react: '*'

  react@${react}:
    resolution: {integrity: sha512-react-${react}}

  react-dom@${react}:
    resolution: {integrity: sha512-react-dom-${react}}
    peerDependencies:
      react: '*'

  scheduler@0.27.0:
    resolution: {integrity: sha512-scheduler}

  '@tanstack/react-query@5.104.5':
    resolution: {integrity: sha512-react-query}
    peerDependencies:
      react: '*'

  '@tanstack/query-core@5.104.5':
    resolution: {integrity: sha512-query-core}

snapshots:

  camox@${camoxVersion}${peers}:
    dependencies:
      react: ${react}

  react@${react}: {}

  react-dom@${react}${peers}:
    dependencies:
      react: ${react}
      scheduler: 0.27.0

  scheduler@0.27.0: {}

  '@tanstack/react-query@5.104.5${peers}':
    dependencies:
      '@tanstack/query-core': 5.104.5
      react: ${react}

  '@tanstack/query-core@5.104.5': {}
`;
}
