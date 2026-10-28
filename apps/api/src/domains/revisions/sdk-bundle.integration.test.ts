import { sdkBundleName } from "camox/_internal/sdkBundleName";
import { abortAllDurableObjects } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { startDraft } from "../../../test/fixtures";
import { pushToMain } from "../../../test/pushes";
import { storeSdkBundle } from "../../../test/sdk-bundles";
import { answerFrom, answerWithToolCall, forgetThreadModel } from "../../../test/thread-model";
import { ask, connectDraftThread, signIn, websiteFixture } from "../../../test/threads";
import { websiteLockfile } from "../../../test/website-lockfile";
import { HOSTED_SDK_BUNDLE_SETTINGS, type SdkBundleNames } from "../sdk-bundles/ensure";
import { revisions } from "./schema";

// A draft's revisions build against their SDK Bundle (ADR 0029). The revision sandbox is faked at
// its binding (test/release-fakes.js): with the switch on, its build names the bundle from the
// workspace's lockfile, as the website's camox does, and fails with the missing-bundle error
// unless the bundle is in its cache. Ensuring one runs in the faked release sandbox.

vi.mock("../../lib/thread-model", async () => {
  const { testThreadModel } = await import("../../../test/thread-model");
  return { threadModel: testThreadModel };
});

type Fakes = {
  buildAgainstSdkBundlesOf(marker: string): Promise<void>;
  revisionBuilds(sandbox: string): Promise<unknown[]>;
  revisionCommands(sandbox: string): Promise<{ command: string }[]>;
  sdkBundleBuilds(): Promise<{ written: Record<string, string> }[]>;
};

const fakes = (env as unknown as { RELEASE_FAKES: Fakes }).RELEASE_FAKES;

afterEach(async () => {
  vi.restoreAllMocks();
  await abortAllDurableObjects();
  forgetThreadModel();
});

/** The website's camox builds trees holding this against an SDK Bundle. */
const SWITCHED_ON = "// built against an SDK Bundle";

/**
 * A website with code on `main`, its lockfile resolving a `react` of its own, so its SDK Bundle
 * is no other test's. With `switchedOn`, its builds name that bundle.
 */
async function websiteWithCode({ switchedOn = true } = {}) {
  const react = `19.3.${Math.floor(Math.random() * 1e9)}`;
  const lockfile = websiteLockfile("1.0.0", { react });
  const website = await websiteFixture({ home: "Hello" });
  await pushToMain(website.project.uuid, {
    "package.json": `{ "name": "acme", "dependencies": { "camox": "^1.0.0" } }\n`,
    "pnpm-lock.yaml": lockfile,
    "src/blocks/hero.tsx": `export const hero = "Welcome to Acme"; ${switchedOn ? SWITCHED_ON : ""}\n`,
  });
  await fakes.buildAgainstSdkBundlesOf(SWITCHED_ON);
  return { ...website, lockfile };
}

/** The SDK Bundle's names for `lockfile`, as a hosted website's camox names it. */
async function namesOf(lockfile: string): Promise<SdkBundleNames> {
  const name = (target: "browser" | "workerd") =>
    sdkBundleName({ lockfile, target, settings: HOSTED_SDK_BUNDLE_SETTINGS });
  return { browser: await name("browser"), workerd: await name("workerd") };
}

type Website = Awaited<ReturnType<typeof websiteWithCode>>;

/** Opens a new draft's thread on `website`. */
async function draftOf(website: Website) {
  const draftId = await startDraft(website.db, website.project.id, website.memberUser.id);
  const thread = await connectDraftThread(
    website.project.id,
    draftId,
    await signIn(website.db, website.memberUser.id),
  );
  return { draftId, thread };
}

/** Has the agent write `files` and build them in one turn, returning what `build` answered. */
async function buildTurn(
  thread: Awaited<ReturnType<typeof draftOf>>["thread"],
  files: Record<string, string>,
  { keepOpen = false } = {},
) {
  for (const [path, content] of Object.entries(files)) {
    answerWithToolCall("write", { path, content });
  }
  let result: string | undefined;
  answerWithToolCall("build", {});
  answerFrom(({ lastToolResult }) => {
    result = lastToolResult;
    return "Built.";
  });
  await ask(thread, "Write and build", { keepOpen });
  return JSON.parse(result!) as { ok: boolean; revision?: string };
}

/** The SDK Bundle a revision records. */
async function sdkBundleOf(website: Website, revision: string) {
  const row = await website.db
    .select({ sdkBundle: revisions.sdkBundle })
    .from(revisions)
    .where(eq(revisions.id, revision))
    .get();
  return row?.sdkBundle;
}

describe("a revision built against an SDK Bundle", () => {
  it("builds with the stored bundle its sandbox got, and records its names", async () => {
    const website = await websiteWithCode();
    const names = await storeSdkBundle(website.lockfile);
    const { draftId, thread } = await draftOf(website);

    const built = await buildTurn(thread, { "src/blocks/pricing.tsx": `export const p = 1;\n` });

    expect(built.ok).toBe(true);
    expect(await sdkBundleOf(website, built.revision!)).toEqual(names);
    // Its first build passed: it never had to be ensured.
    expect(await fakes.revisionBuilds(draftId)).toHaveLength(1);
  });

  it("fetches its bundle once for the builds of the same lockfile", async () => {
    const website = await websiteWithCode();
    const names = await storeSdkBundle(website.lockfile);
    const { draftId, thread } = await draftOf(website);

    await buildTurn(
      thread,
      { "src/blocks/pricing.tsx": `export const p = 1;\n` },
      { keepOpen: true },
    );
    const second = await buildTurn(thread, { "src/blocks/pricing.tsx": `export const p = 2;\n` });

    expect(second.ok).toBe(true);
    // One unpack per target into its sandbox's cache, named after the target's bundle.
    const unpacked = (await fakes.revisionCommands(draftId)).flatMap(({ command }) =>
      command.includes("tar -xzf") ? [/\bmv -T \S+ \S+\/([0-9a-f]{32})$/.exec(command)?.[1]] : [],
    );
    expect(unpacked).toHaveLength(2);
    expect(new Set(unpacked)).toEqual(new Set([names.browser, names.workerd]));
  });

  it("ensures a missing bundle, then builds again", async () => {
    // Only the draft's code builds against it: `main`'s release would ensure it otherwise.
    const website = await websiteWithCode({ switchedOn: false });
    const { draftId, thread } = await draftOf(website);

    const built = await buildTurn(thread, {
      "src/blocks/pricing.tsx": `export const p = 1; ${SWITCHED_ON}\n`,
    });

    expect(built.ok).toBe(true);
    const ensured = (await fakes.sdkBundleBuilds()).filter(
      ({ written }) => written["pnpm-lock.yaml"] === website.lockfile,
    );
    expect(ensured).toHaveLength(1);
    expect(await sdkBundleOf(website, built.revision!)).toEqual(await namesOf(website.lockfile));
    expect(await fakes.revisionBuilds(draftId)).toHaveLength(2);
  });

  it("logs the spans of its build, archive, save, push and preview", async () => {
    const website = await websiteWithCode();
    await storeSdkBundle(website.lockfile);
    const { thread } = await draftOf(website);
    const logged = vi.spyOn(console, "log");

    await buildTurn(thread, { "src/blocks/pricing.tsx": `export const p = 1;\n` });

    const spans = logged.mock.calls.flatMap(([line]) => {
      try {
        const { timing, ok } = JSON.parse(String(line)) as { timing?: string; ok?: boolean };
        return timing && ok ? [timing] : [];
      } catch {
        return [];
      }
    });
    expect(spans).toEqual(
      expect.arrayContaining([
        "revision.sandbox.viteBuild",
        "revision.sandbox.archive",
        "revision.build.r2Put",
        "revision.build.push",
        "revision.preview.prepare",
        "revision.preview",
        "revision.build",
      ]),
    );
  });
});

describe("a whole-app revision", () => {
  it("records no SDK Bundle", async () => {
    const website = await websiteWithCode({ switchedOn: false });
    const { thread } = await draftOf(website);

    const built = await buildTurn(thread, { "src/blocks/pricing.tsx": `export const p = 1;\n` });

    expect(built.ok).toBe(true);
    expect(await sdkBundleOf(website, built.revision!)).toBeNull();
  });
});
