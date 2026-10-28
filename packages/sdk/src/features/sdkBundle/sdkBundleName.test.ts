import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { type SdkBundleNameInputs, type SdkBundleSettings, sdkBundleName } from "./sdkBundleName";

/** A package's entry in the lockfile's `packages` and `snapshots` sections. */
interface LockedPackage {
  integrity: string;
  /** The peers pnpm resolved it with, which suffix its snapshot: `(react@19.3.1)`. */
  peersResolved?: string;
  /** The packages it depends on, by `name@version`, its resolved peers included. */
  dependencies?: string[];
  peerDependencies?: string[];
}

/**
 * A pnpm lockfile for a website that installs camox from npm, as a hosted project does. camox
 * depends on `@base-ui/react`, which depends on `@floating-ui/react`, and takes
 * `@cloudflare/vite-plugin` as a peer, which pnpm resolves into camox's snapshot. Its CLI, a
 * dependency too, runs in Node beside the website's build.
 */
function lockfile({
  packages: overrides = {},
  devDependencies = ["vite@8.0.0", "wrangler@4.151.0"],
}: {
  packages?: Record<string, Partial<LockedPackage>>;
  devDependencies?: string[];
} = {}): string {
  const packages: Record<string, LockedPackage> = {
    "camox@0.59.0": {
      integrity: "sha512-camox",
      peersResolved: "(a222673b37e17d6da485dea4086e4221)",
      dependencies: [
        "@base-ui/react@1.9.0",
        "@camox/cli@0.59.0",
        "react@19.3.1",
        "@cloudflare/vite-plugin@1.64.0",
      ],
      peerDependencies: ["@cloudflare/vite-plugin"],
    },
    "@base-ui/react@1.9.0": {
      integrity: "sha512-base-ui",
      peersResolved: "(react@19.3.1)",
      dependencies: ["@floating-ui/react@0.27.0", "react@19.3.1"],
      peerDependencies: ["react"],
    },
    "@floating-ui/react@0.27.0": { integrity: "sha512-floating-ui" },
    "@camox/cli@0.59.0": { integrity: "sha512-camox-cli", dependencies: ["@clack/prompts@1.8.1"] },
    "@clack/prompts@1.8.1": { integrity: "sha512-clack-prompts" },
    "react@19.3.1": { integrity: "sha512-react" },
    "react-dom@19.3.1": {
      integrity: "sha512-react-dom",
      peersResolved: "(react@19.3.1)",
      dependencies: ["react@19.3.1", "scheduler@0.27.0"],
      peerDependencies: ["react"],
    },
    "scheduler@0.27.0": { integrity: "sha512-scheduler" },
    "@tanstack/react-query@5.104.5": {
      integrity: "sha512-react-query",
      peersResolved: "(react@19.3.1)",
      dependencies: ["@tanstack/query-core@5.104.5", "react@19.3.1"],
      peerDependencies: ["react"],
    },
    "@tanstack/query-core@5.104.5": { integrity: "sha512-query-core" },
    "@cloudflare/vite-plugin@1.64.0": {
      integrity: "sha512-cloudflare-vite-plugin",
      peersResolved: "(vite@8.0.0)(wrangler@4.151.0)",
      dependencies: ["vite@8.0.0", "wrangler@4.151.0"],
      peerDependencies: ["vite", "wrangler"],
    },
    "vite@8.0.0": { integrity: "sha512-vite" },
    "wrangler@4.151.0": { integrity: "sha512-wrangler" },
    "typescript@6.0.0": { integrity: "sha512-typescript" },
  };
  for (const [key, override] of Object.entries(overrides)) {
    packages[key] = { ...packages[key], ...override } as LockedPackage;
  }
  const split = (key: string) => {
    const at = key.lastIndexOf("@");
    return { name: key.slice(0, at), version: key.slice(at + 1) };
  };
  /** How a dependent names `key`'s version: with the peers it was resolved with. */
  const lockedVersion = (key: string) => split(key).version + (packages[key]?.peersResolved ?? "");
  const quote = (value: string) => `'${value}'`;
  const section = (lines: string[]) => lines.join("\n");
  const importerDependencies = (keys: string[]) =>
    section(
      keys.map(
        (key) =>
          `      ${quote(split(key).name)}:\n        specifier: '*'\n        version: ${quote(lockedVersion(key))}`,
      ),
    );
  const dependencyMap = (keys: string[]) =>
    section(keys.map((key) => `      ${quote(split(key).name)}: ${quote(lockedVersion(key))}`));
  const dependencies = ["camox", "react", "react-dom", "@tanstack/react-query"].map((name) =>
    Object.keys(packages).find((key) => split(key).name === name)!,
  );
  return `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
${importerDependencies(dependencies)}
    devDependencies:
${importerDependencies(devDependencies)}

packages:

${Object.entries(packages)
  .map(
    ([key, pkg]) =>
      `  ${quote(key)}:\n    resolution: {integrity: ${pkg.integrity}}` +
      (pkg.peerDependencies
        ? `\n    peerDependencies:\n${section(pkg.peerDependencies.map((name) => `      ${quote(name)}: '*'`))}`
        : ""),
  )
  .join("\n\n")}

snapshots:

${Object.entries(packages)
  .map(
    ([key, pkg]) =>
      `  ${quote(key + (pkg.peersResolved ?? ""))}:` +
      (pkg.dependencies ? `\n    dependencies:\n${dependencyMap(pkg.dependencies)}` : " {}"),
  )
  .join("\n\n")}
`;
}

const settings: SdkBundleSettings = {
  iconIds: ["arrow-right", "check"],
  telemetryDisabled: false,
  experimentalFeatures: false,
  apiUrl: "https://api.camox.ai",
};

const inputs = (overrides: Partial<SdkBundleNameInputs> = {}): SdkBundleNameInputs => ({
  lockfile: lockfile(),
  target: "browser",
  settings,
  ...overrides,
});

void describe("an SDK Bundle's name", () => {
  void test("is the same for the same inputs", async () => {
    const name = await sdkBundleName(inputs());
    assert.equal(await sdkBundleName(inputs()), name);
    // It names a URL path segment: `/_camox/sdk/<name>/`.
    assert.match(name, /^[0-9a-z]+$/);
  });

  void test("changes when a package the bundle reaches resolves differently", async () => {
    const name = await sdkBundleName(inputs());
    const changes: Record<string, Record<string, Partial<LockedPackage>>> = {
      "camox itself": { "camox@0.59.0": { integrity: "sha512-camox-republished" } },
      "a dependency of camox's dependency": {
        "@floating-ui/react@0.27.0": { integrity: "sha512-floating-ui-republished" },
      },
      React: { "react@19.3.1": { integrity: "sha512-react-republished" } },
      "a dependency of React DOM": {
        "scheduler@0.27.0": { integrity: "sha512-scheduler-republished" },
      },
      "TanStack Query's core": {
        "@tanstack/query-core@5.104.5": { integrity: "sha512-query-core-republished" },
      },
    };
    for (const [change, packages] of Object.entries(changes)) {
      assert.notEqual(
        await sdkBundleName(inputs({ lockfile: lockfile({ packages }) })),
        name,
        change,
      );
    }
  });

  void test("changes when a bundled package moves to another version", async () => {
    const upgraded = lockfile()
      .replaceAll("scheduler@0.27.0", "scheduler@0.28.0")
      .replaceAll("'scheduler': '0.27.0'", "'scheduler': '0.28.0'");
    assert.notEqual(
      await sdkBundleName(inputs({ lockfile: upgraded })),
      await sdkBundleName(inputs()),
    );
  });

  void test("doesn't change for packages outside the bundle", async () => {
    const name = await sdkBundleName(inputs());
    const elsewhere = {
      "Vite and wrangler, which the website builds with": lockfile({
        packages: {
          "vite@8.0.0": { integrity: "sha512-vite-republished" },
          "wrangler@4.151.0": { integrity: "sha512-wrangler-republished" },
        },
      }),
      "camox's Vite plugin peer, which only its Vite plugin imports": lockfile({
        packages: {
          "@cloudflare/vite-plugin@1.64.0": { integrity: "sha512-cloudflare-republished" },
        },
      }),
      "camox's CLI, which runs beside the build": lockfile({
        packages: { "@clack/prompts@1.8.1": { integrity: "sha512-clack-prompts-republished" } },
      }),
      "a dev dependency the website adds": lockfile({
        devDependencies: ["vite@8.0.0", "wrangler@4.151.0", "typescript@6.0.0"],
      }),
    };
    for (const [change, changed] of Object.entries(elsewhere)) {
      assert.equal(await sdkBundleName(inputs({ lockfile: changed })), name, change);
    }
  });

  void test("changes with the builder's version, the target and each compiled setting", async () => {
    const name = await sdkBundleName(inputs());
    const changes: Record<string, Partial<SdkBundleNameInputs>> = {
      "the builder's version": { builderVersion: "a later builder" },
      "the target": { target: "workerd" },
      "the icon ids": { settings: { ...settings, iconIds: ["arrow-right"] } },
      telemetry: { settings: { ...settings, telemetryDisabled: true } },
      "experimental features": { settings: { ...settings, experimentalFeatures: true } },
      "the API URL": { settings: { ...settings, apiUrl: "http://localhost:8787" } },
    };
    for (const [change, overrides] of Object.entries(changes)) {
      assert.notEqual(await sdkBundleName(inputs(overrides)), name, change);
    }
  });

  void test("reads the importer of a website inside a workspace", async () => {
    const atRoot = lockfile();
    const inWorkspace = atRoot.replace("\n  .:\n", "\n  sites/website:\n");
    assert.equal(
      await sdkBundleName(inputs({ lockfile: inWorkspace, importer: "sites/website" })),
      await sdkBundleName(inputs({ lockfile: atRoot })),
    );
  });
});
