import { abortAllDurableObjects } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { desc, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { startDraft } from "../../../test/fixtures";
import { pushToMain } from "../../../test/pushes";
import { storeSdkBundle } from "../../../test/sdk-bundles";
import {
  answerFrom,
  answerWithCodeRequest,
  answerWithToolCall,
  forgetThreadModel,
} from "../../../test/thread-model";
import { ask, connectDraftThread, signIn, websiteFixture } from "../../../test/threads";
import { websiteLockfile } from "../../../test/website-lockfile";
import { untarGzip } from "../../lib/tar";
import { sdkBundleArchiveKey } from "../sdk-bundles/ensure";
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
  sdkBundleBuilds(): Promise<{ sandbox: string; written: Record<string, string> }[]>;
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
  const lockfile = uniqueLockfile();
  const website = await websiteFixture({ home: "Hello" });
  const main = (lockfile: string) => ({
    "package.json": `{ "name": "acme", "dependencies": { "camox": "^1.0.0" } }\n`,
    "pnpm-lock.yaml": lockfile,
    "src/blocks/hero.tsx": `export const hero = "Welcome to Acme"; ${switchedOn ? SWITCHED_ON : ""}\n`,
  });
  await pushToMain(website.project.uuid, main(lockfile));
  await fakes.buildAgainstSdkBundlesOf(SWITCHED_ON);
  return {
    ...website,
    lockfile,
    /** Pushes `main` again with `lockfile`, as an Upgrade does. */
    pushLockfile: (lockfile: string) => pushToMain(website.project.uuid, main(lockfile)),
  };
}

/** A lockfile resolving a `react` of its own, so its SDK Bundle is no other test's. */
const uniqueLockfile = () =>
  websiteLockfile("1.0.0", { react: `19.3.${Math.floor(Math.random() * 1e9)}` });

/** The manifest of the SDK Bundle target stored under `name`, which the fake build names it in. */
async function storedManifest(name: string) {
  const archive = await env.REVISION_BUILDS.get(sdkBundleArchiveKey(name));
  if (!archive) return null;
  return new TextDecoder().decode((await untarGzip(archive.body)).get("sdk-bundle.json"));
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

/** Has the Code Agent write `files` and build them in one request, returning what `build` answered. */
async function buildTurn(
  thread: Awaited<ReturnType<typeof draftOf>>["thread"],
  files: Record<string, string>,
  { keepOpen = false } = {},
) {
  answerWithCodeRequest();
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

  it("fetches the new bundle into the same sandbox when a merge changes the draft's lockfile", async () => {
    const website = await websiteWithCode();
    await storeSdkBundle(website.lockfile);
    const { draftId, thread } = await draftOf(website);
    await buildTurn(thread, { "src/blocks/pricing.tsx": `export const p = 1;\n` });
    const upgraded = uniqueLockfile();
    const names = await storeSdkBundle(upgraded);

    // An Upgrade's push to `main`, which Camox merges into the draft.
    await website.pushLockfile(upgraded);

    // The turn's build and the merge's, in the draft's one sandbox: neither failed for want of
    // its bundle.
    expect(await fakes.revisionBuilds(draftId)).toHaveLength(2);
    const [revision] = await website.db
      .select({ sdkBundle: revisions.sdkBundle })
      .from(revisions)
      .where(eq(revisions.draftId, draftId))
      .orderBy(desc(revisions.createdAt))
      .limit(1);
    expect(revision!.sdkBundle).toEqual(names);
    // Its sandbox fetched it from R2: nothing ensured it.
    const ensured = (await fakes.sdkBundleBuilds()).filter(
      ({ written }) => written["pnpm-lock.yaml"] === upgraded,
    );
    expect(ensured).toEqual([]);
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
    // It records the bundle that ensuring built and stored.
    const recorded = await sdkBundleOf(website, built.revision!);
    for (const name of Object.values(recorded ?? {})) {
      expect(await storedManifest(name)).toBe(
        `SDK Bundle ${name}, built in ${ensured[0]!.sandbox}`,
      );
    }
    expect(Object.keys(recorded ?? {}).sort()).toEqual(["browser", "workerd"]);
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
