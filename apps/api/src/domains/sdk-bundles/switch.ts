import type { getSandbox } from "@cloudflare/sandbox";

// Whether a website builds against an SDK Bundle is its own camox's call (the switch,
// `CAMOX_INTERNAL_SDK_BUNDLE`), which the API can't know. So it asks that camox where it's
// installed.

/**
 * Asks the website's own camox whether its build is against an SDK Bundle. A camox from before
 * SDK Bundles has no `buildsAgainstSdkBundle`, and builds whole-app. Run with
 * `node --input-type=module`, which resolves its imports from the folder it runs in.
 */
const SWITCH_PROBE = `
const sdkBundle = await import("camox/_internal/sdkBundle").catch(() => ({}));
console.log(sdkBundle.buildsAgainstSdkBundle?.(process.env) ? "sdk-bundle" : "whole-app");
`;

/**
 * Whether the camox installed in `cwd` builds against an SDK Bundle, with the build's
 * environment `buildEnv`, which may set the switch.
 */
export async function buildsAgainstSdkBundle(
  sandbox: Pick<ReturnType<typeof getSandbox>, "exec">,
  cwd: string,
  buildEnv: Record<string, string> = {},
): Promise<boolean> {
  const probed = await sandbox.exec('node --input-type=module -e "$CAMOX_SDK_BUNDLE_PROBE"', {
    cwd,
    env: { ...buildEnv, CAMOX_SDK_BUNDLE_PROBE: SWITCH_PROBE },
  });
  if (!probed.success) {
    throw new Error(`The website's camox didn't answer: ${probed.stderr.trim()}`);
  }
  return probed.stdout.trim() === "sdk-bundle";
}
