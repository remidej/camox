import { DRAFT_HEADER } from "@camox/api-contract/drafts";
import { call } from "@orpc/server";
import { abortAllDurableObjects } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { type Checkout, checkoutOf } from "../../../test/checkouts";
import { createRpcContext } from "../../../test/fixtures";
import { pushToMain } from "../../../test/pushes";
import {
  broken,
  failingMarker,
  type FakeTypeError,
  HERO,
  LOCKFILE,
  PRICING,
  revisionFakes as fakes,
  typeErrorsMarker,
  websiteWithCode,
} from "../../../test/revision-builds";
import type { Website } from "../../../test/threads";
import { router } from "../../router";
import { projects } from "../../schema";

// A member pushes commits from their own checkout of a flagged project onto a draft, through the
// API, never to the repo (ADR 0026). The API checks the pushed code against the agent's line
// (ADR 0021) and refuses what doesn't fit, writing nothing; accepted commits land as they are on
// the draft's branch, and their head becomes a revision, built and previewed like the agent's.

afterEach(async () => {
  await abortAllDurableObjects();
});

const PRICING_FILE = "src/blocks/pricing.tsx";
const HERO_FILE = "src/blocks/hero.tsx";
const PACKAGE = `{ "name": "acme", "dependencies": { "camox": "1.0.0" } }\n`;

/** `main`'s files, as `websiteWithCode` pushed them, with `changes`. */
const mainWith = (changes: Record<string, string>) => ({
  "package.json": PACKAGE,
  "pnpm-lock.yaml": LOCKFILE,
  [HERO_FILE]: HERO,
  ...changes,
});

/** An Upgrade's change to `main`: a new `camox` in the manifest and the lockfile. */
const UPGRADE = {
  "package.json": PACKAGE.replace("1.0.0", "1.1.0"),
  "pnpm-lock.yaml": LOCKFILE.replaceAll("1.0.0", "1.1.0"),
};

const branchesOf = (repo: string) =>
  (fakes as unknown as { branches(repo: string): Promise<string[]> }).branches(repo);

/** A flagged project's website with code on `main`, and a member's checkout of it. */
async function flaggedWebsite() {
  const website = await websiteWithCode();
  await website.db
    .update(projects)
    .set({ codeOutsideCamox: true })
    .where(eq(projects.id, website.project.id));
  const checkout = await checkoutOf(website.project.uuid);
  return { website, checkout };
}

/** Pushes the checkout's branch as `camox push` does, as the website's member unless told. */
async function push(website: Website, checkout: Checkout, { as = website.memberUser } = {}) {
  return call(
    router.code.push,
    {
      projectUuid: website.project.uuid,
      branch: checkout.branch,
      bundle: await checkout.bundle(),
    },
    { context: createRpcContext(website.db, as) },
  );
}

const draftsOf = async (website: Website) =>
  (
    await call(
      router.drafts.list,
      { projectId: website.project.id },
      { context: createRpcContext(website.db, website.memberUser) },
    )
  ).drafts;

const previewOf = (website: Website, draftId: string) =>
  call(
    router.drafts.previewPublish,
    { projectId: website.project.id },
    { context: createRpcContext(website.db, website.memberUser, { [DRAFT_HEADER]: draftId }) },
  );

describe("pushing a new branch", () => {
  it("opens a draft named after the branch, whose branch is the pushed commits and whose preview shows them", async () => {
    const { website, checkout } = await flaggedWebsite();
    await checkout.commit({ [PRICING_FILE]: PRICING }, "Add a pricing section");
    await checkout.commit({ [PRICING_FILE]: `${PRICING}// Monthly\n` }, "Bill monthly");

    const pushed = await push(website, checkout);

    expect(pushed.result).toMatchObject({ ok: true });
    const drafts = await draftsOf(website);
    expect(drafts.find(({ id }) => id === pushed.draftId)).toMatchObject({ name: "pricing" });
    // The draft's branch is the checkout's, commits included, so the checkout fast-forwards.
    expect(await checkout.remoteLog(pushed.branch)).toEqual(await checkout.log());
    // One build, of the pushed head, which the draft previews.
    const builds = await fakes.revisionBuilds(pushed.draftId);
    expect(builds).toHaveLength(1);
    expect(builds[0]!.files).toMatchObject({
      [PRICING_FILE]: `${PRICING}// Monthly\n`,
      "src/blocks/hero.tsx": HERO,
      "pnpm-lock.yaml": LOCKFILE,
    });
    expect((await previewOf(website, pushed.draftId)).code).toMatchObject({
      revision: pushed.result.revision,
      building: false,
    });
    expect(pushed.studioUrl).toBe(
      `https://${website.project.slug}.camox.site/?camox-draft=${pushed.draftId}`,
    );
  });
});

describe("a refused push", () => {
  /** Expects the push to be refused for `reason`, having written no draft, branch or revision. */
  async function expectRefused(
    website: Website,
    checkout: Checkout,
    reason: string,
    message: RegExp,
  ) {
    const refusal = await push(website, checkout).catch((error: unknown) => error);
    expect(refusal).toMatchObject({ code: "PUSH_REFUSED", data: { reason }, message });
    expect(await draftsOf(website)).toEqual([]);
    expect(await branchesOf(website.project.uuid)).toEqual(["main"]);
    return refusal as { data: Record<string, unknown> };
  }

  it.each([
    ["the Vite config", "vite.config.ts"],
    ["the manifest", "package.json"],
    ["a file outside src/", "README.md"],
    ["a file under src/camox/", "src/camox/routes.ts"],
  ])("refuses a branch that changes %s, a platform-owned file", async (_, file) => {
    const { website, checkout } = await flaggedWebsite();
    await checkout.commit({ [PRICING_FILE]: PRICING, [file]: "export default {};\n" });

    await expectRefused(website, checkout, "platformFile", new RegExp(file.replaceAll(".", "\\.")));
  });

  it("refuses a branch that deletes a platform-owned file", async () => {
    const { website, checkout } = await flaggedWebsite();
    await checkout.commit({ "pnpm-lock.yaml": null });

    await expectRefused(website, checkout, "platformFile", /pnpm-lock\.yaml/);
  });

  it("refuses a branch that adds a file under src/ that isn't TypeScript or CSS", async () => {
    const { website, checkout } = await flaggedWebsite();
    await checkout.commit({ [PRICING_FILE]: PRICING, "src/assets/logo.svg": "<svg />\n" });

    await expectRefused(website, checkout, "notCode", /src\/assets\/logo\.svg/);
  });

  it("refuses a branch that starts from a commit that was never on main", async () => {
    const { website, checkout } = await flaggedWebsite();
    const neverPushed = await checkout.commit({ [PRICING_FILE]: PRICING }, "Never pushed");
    await checkout.commit({ [PRICING_FILE]: `${PRICING}// Monthly\n` });

    // The bundle builds on a commit only the checkout has.
    const refusal = await call(
      router.code.push,
      {
        projectUuid: website.project.uuid,
        branch: checkout.branch,
        bundle: await checkout.bundle({ since: neverPushed }),
      },
      { context: createRpcContext(website.db, website.memberUser) },
    ).catch((error: unknown) => error);

    expect(refusal).toMatchObject({
      code: "PUSH_REFUSED",
      data: { reason: "baseNotOnMain" },
      message: expect.stringMatching(/never on `main`/),
    });
    expect(await draftsOf(website)).toEqual([]);
    expect(await branchesOf(website.project.uuid)).toEqual(["main"]);
  });

  it("refuses a branch that conflicts with the current main", async () => {
    const { website, checkout } = await flaggedWebsite();
    await checkout.commit({ [HERO_FILE]: `export const hero = "Welcome, friends";\n` });
    await pushToMain(
      website.project.uuid,
      mainWith({ [HERO_FILE]: `export const hero = "Welcome to the new Acme";\n` }),
    );

    await expectRefused(
      website,
      checkout,
      "conflictsWithMain",
      /src\/blocks\/hero\.tsx.*Merge `main`/,
    );
  });

  it("refuses a branch whose head doesn't build, with the build's errors", async () => {
    const { website, checkout } = await flaggedWebsite();
    const marker = await failingMarker(PRICING_FILE);
    await checkout.commit({ [PRICING_FILE]: broken(marker) });

    const refusal = await expectRefused(website, checkout, "doesNotBuild", /doesn't build/);

    expect(refusal.data.build).toEqual([
      expect.objectContaining({ file: PRICING_FILE, message: expect.stringMatching(/missing/) }),
    ]);
  });

  it("refuses a branch missing an Upgrade that's on main, telling the member to merge main", async () => {
    const { website, checkout } = await flaggedWebsite();
    await checkout.commit({ [PRICING_FILE]: PRICING });
    await pushToMain(website.project.uuid, mainWith(UPGRADE), "Upgrade camox");

    await expectRefused(website, checkout, "mergeMainFirst", /package\.json.*Merge `main` first/);
  });

  it("refuses a project whose code can't be worked on outside Camox", async () => {
    const website = await websiteWithCode();
    const checkout = await checkoutOf(website.project.uuid);
    await checkout.commit({ [PRICING_FILE]: PRICING });

    await expect(push(website, checkout)).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringMatching(/can't be worked on outside Camox/),
    });
    expect(await draftsOf(website)).toEqual([]);
    expect(await branchesOf(website.project.uuid)).toEqual(["main"]);
  });

  it("refuses someone outside the project's organization", async () => {
    const { website, checkout } = await flaggedWebsite();
    await checkout.commit({ [PRICING_FILE]: PRICING });

    await expect(push(website, checkout, { as: website.outsiderUser })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(await draftsOf(website)).toEqual([]);
    expect(await branchesOf(website.project.uuid)).toEqual(["main"]);
  });
});

describe("an accepted push", () => {
  it("passes with an Upgrade merged from main, which its build has", async () => {
    const { website, checkout } = await flaggedWebsite();
    await checkout.commit({ [PRICING_FILE]: PRICING });
    await pushToMain(website.project.uuid, mainWith(UPGRADE), "Upgrade camox");
    await checkout.mergeMain();

    const pushed = await push(website, checkout);

    expect(pushed.result).toMatchObject({ ok: true });
    expect(await checkout.remoteLog(pushed.branch)).toEqual(await checkout.log());
    const [build] = await fakes.revisionBuilds(pushed.draftId);
    expect(build!.files).toMatchObject({ ...UPGRADE, [PRICING_FILE]: PRICING });
    expect((await previewOf(website, pushed.draftId)).code).toMatchObject({ includesLive: true });
  });

  it("shows the head's type errors as a Blocker on the draft", async () => {
    const { website, checkout } = await flaggedWebsite();
    const error: FakeTypeError = {
      file: PRICING_FILE,
      line: 2,
      column: 7,
      code: "TS2322",
      message: "Type 'number' is not assignable to type 'string'.",
    };
    const marker = await typeErrorsMarker([error]);
    await checkout.commit({ [PRICING_FILE]: `${PRICING}// ${marker}\n` });

    const pushed = await push(website, checkout);

    expect(pushed.result).toMatchObject({
      ok: false,
      types: [expect.objectContaining({ file: PRICING_FILE, code: "TS2322" })],
    });
    expect((await previewOf(website, pushed.draftId)).blockers).toEqual([
      expect.objectContaining({ entity: "code", code: "codeDoesNotTypeCheck" }),
    ]);
  });
});
