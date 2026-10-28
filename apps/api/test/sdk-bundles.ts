import { sdkBundleName } from "camox/_internal/sdkBundleName";
import { env } from "cloudflare:workers";

import { HOSTED_SDK_BUNDLE_SETTINGS, type SdkBundleNames } from "../src/domains/sdk-bundles/ensure";
import { tar } from "../src/lib/tar";

/** The SDK Bundle's names for `lockfile`, as a hosted website's camox names it. */
export async function sdkBundleNamesFor(lockfile: string): Promise<SdkBundleNames> {
  const name = (target: "browser" | "workerd") =>
    sdkBundleName({ lockfile, target, settings: HOSTED_SDK_BUNDLE_SETTINGS });
  return { browser: await name("browser"), workerd: await name("workerd") };
}

/** The files of a stored SDK Bundle's target, by path from its folder, as the fake stores them. */
export const sdkBundleFiles = (name: string, target: "browser" | "workerd") =>
  target === "browser"
    ? {
        "entry.mjs": `// the browser SDK Bundle ${name}\n`,
        "camox-studio-Q2x8.css": `/* ${name} */\n`,
        "sdk-bundle.json": JSON.stringify({ name, target }),
      }
    : {
        "entry.mjs": `// the workerd SDK Bundle ${name}\nimport "./chunks/react.mjs";\n`,
        "chunks/react.mjs": `// React, in ${name}\n`,
        "sdk-bundle.json": JSON.stringify({ name, target }),
      };

/**
 * Stores the SDK Bundle of `lockfile` in `REVISION_BUILDS` as ensuring it does: one gzipped tar
 * archive per target, of `sdkBundleFiles`, at `sdk/<name>.tar.gz`.
 */
export async function storeSdkBundle(lockfile: string): Promise<SdkBundleNames> {
  const names = await sdkBundleNamesFor(lockfile);
  const encoder = new TextEncoder();
  for (const target of ["browser", "workerd"] as const) {
    const archive = tar(
      Object.entries(sdkBundleFiles(names[target], target)).map(([path, content]) => ({
        path: `./${path}`,
        mode: 0o644,
        content: encoder.encode(content),
      })),
    );
    const gzipped = await new Response(
      new Blob([archive]).stream().pipeThrough(new CompressionStream("gzip")),
    ).arrayBuffer();
    await env.REVISION_BUILDS.put(`sdk/${names[target]}.tar.gz`, gzipped);
  }
  return names;
}
