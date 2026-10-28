import { sdkBundleName } from "camox/_internal/sdkBundleName";
import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vite-plus/test";

import { sdkBundleFiles, storeSdkBundle } from "../../../test/sdk-bundles";
import { websiteLockfile } from "../../../test/website-lockfile";
import { untarGzip } from "../../lib/tar";
import {
  ensureSdkBundle,
  HOSTED_SDK_BUNDLE_SETTINGS,
  sdkBundleArchiveKey,
  type SdkBundleNames,
  sdkBundleNamesOf,
} from "./ensure";

// Ensuring an SDK Bundle is the only step that stores one (ADR 0029). The release sandbox it builds
// in is faked at its binding (test/release-fakes.js): its build of the bundle names it with the
// website's camox, from the lockfile written to it, and archives a manifest naming the build.

const fakes = (env as unknown as { RELEASE_FAKES: SdkBundleFakes }).RELEASE_FAKES;

type SdkBundleBuild = {
  sandbox: string;
  /** The files written to the sandbox before it installed, by path from the website's folder. */
  written: Record<string, string>;
  commands: string[];
  restoredBackup: boolean;
};

type SdkBundleFakes = {
  sdkBundleBuilds(): Promise<SdkBundleBuild[]>;
  /** Makes the builds whose lockfile contains `marker` wait until they're let go. */
  holdSdkBundleBuildsOf(marker: string): Promise<void>;
  letGoSdkBundleBuild(sandbox: string): Promise<void>;
  /** Makes the builds whose lockfile contains `marker` report `names` instead of their own. */
  forgeSdkBundleNamesOf(marker: string, names: SdkBundleNames): Promise<void>;
};

/** A website on its own camox version, so no other test stores its SDK Bundle. */
function website() {
  const camoxVersion = `0.11.0-test.${crypto.randomUUID().slice(0, 8)}`;
  const lockfile = websiteLockfile(camoxVersion);
  const packageJson = JSON.stringify({
    name: "site",
    private: true,
    scripts: { postinstall: "node steal-the-bundle.js" },
    dependencies: { camox: `^${camoxVersion}` },
  });
  return { lockfile, packageJson };
}

async function namesOf(lockfile: string) {
  const name = (target: "browser" | "workerd") =>
    sdkBundleName({ lockfile, target, settings: HOSTED_SDK_BUNDLE_SETTINGS });
  return { browser: await name("browser"), workerd: await name("workerd") };
}

/** The manifest of the SDK Bundle stored under `name`, which the fake build names it in. */
async function stored(name: string) {
  const archive = await env.REVISION_BUILDS.get(sdkBundleArchiveKey(name));
  if (!archive) return null;
  return new TextDecoder().decode((await untarGzip(archive.body)).get("sdk-bundle.json"));
}

/** The builds of the SDK Bundle of a website's lockfile, in the order they started. */
async function buildsOf(lockfile: string) {
  return (await fakes.sdkBundleBuilds()).filter(
    ({ written }) => written["pnpm-lock.yaml"] === lockfile,
  );
}

describe("ensuring an SDK Bundle", () => {
  it("builds a missing SDK Bundle in a fresh release sandbox from the lockfile alone, and stores each target under its name", async () => {
    const source = website();

    const names = await ensureSdkBundle(env, source);

    expect(names).toEqual(await namesOf(source.lockfile));
    const [build, ...others] = await buildsOf(source.lockfile);
    expect(others).toEqual([]);
    // No website code and no cache: only the manifest without its scripts, and the lockfile.
    expect(build!.restoredBackup).toBe(false);
    expect(Object.keys(build!.written).sort()).toEqual(["package.json", "pnpm-lock.yaml"]);
    expect(build!.written["pnpm-lock.yaml"]).toBe(source.lockfile);
    expect(JSON.parse(build!.written["package.json"]!).scripts).toBeUndefined();
    expect(build!.commands).toContainEqual(
      expect.stringContaining("pnpm install --frozen-lockfile"),
    );
    for (const name of Object.values(names)) {
      expect(await stored(name)).toContain(`SDK Bundle ${name}, built in ${build!.sandbox}`);
    }
  });

  it("returns a stored SDK Bundle's names without building it", async () => {
    const source = website();
    const names = await storeSdkBundle(source.lockfile);

    expect(await ensureSdkBundle(env, source)).toEqual(names);

    expect(await buildsOf(source.lockfile)).toEqual([]);
    expect(await stored(names.browser)).toBe(
      sdkBundleFiles(names.browser, "browser")["sdk-bundle.json"],
    );
    expect(await stored(names.workerd)).toBe(
      sdkBundleFiles(names.workerd, "workerd")["sdk-bundle.json"],
    );
  });

  it("stores nothing when the website's camox reports another lockfile's names", async () => {
    // A lockfile can point `camox` at a fork, whose builder could name its bytes after the
    // Template's next SDK Bundle, which the conditional write would then keep for everyone.
    const source = website();
    const victim = await sdkBundleNamesOf(website().lockfile);
    await fakes.forgeSdkBundleNamesOf(source.lockfile, victim);

    await expect(ensureSdkBundle(env, source)).rejects.toThrow(/other names/);

    expect(await buildsOf(source.lockfile)).toHaveLength(1);
    for (const name of [
      ...Object.values(victim),
      ...Object.values(await namesOf(source.lockfile)),
    ]) {
      expect(await stored(name)).toBeNull();
    }
  });

  it("keeps the first stored bytes when two ensures of one SDK Bundle race", async () => {
    const source = website();
    await fakes.holdSdkBundleBuildsOf(source.lockfile);

    const first = ensureSdkBundle(env, source);
    const second = ensureSdkBundle(env, source);
    await vi.waitFor(async () => expect(await buildsOf(source.lockfile)).toHaveLength(2), {
      timeout: 10_000,
    });
    const [firstBuild, secondBuild] = await buildsOf(source.lockfile);
    // One build stores its bundle while the other still builds, then that one finishes.
    await fakes.letGoSdkBundleBuild(firstBuild!.sandbox);
    const firstNames = await Promise.race([first, second]);
    await fakes.letGoSdkBundleBuild(secondBuild!.sandbox);
    const names = await Promise.all([first, second]);

    expect(names).toEqual([firstNames, firstNames]);
    for (const name of Object.values(firstNames)) {
      expect(await stored(name)).toContain(`built in ${firstBuild!.sandbox}`);
    }
  });
});
