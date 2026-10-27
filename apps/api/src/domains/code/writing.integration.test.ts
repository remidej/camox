import { DEVELOPMENT_DRAFT, DRAFT_HEADER } from "@camox/api-contract/drafts";
import { call } from "@orpc/server";
import { abortAllDurableObjects, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createRpcContext, openDevelopmentDraft, startDraft } from "../../../test/fixtures";
import { pushToMain } from "../../../test/pushes";
import { LOCKFILE } from "../../../test/revision-builds";
import {
  answerFrom,
  answerNext,
  answerWithScript,
  answerWithToolCall,
  forgetThreadModel,
} from "../../../test/thread-model";
import {
  ask,
  connectDraftThread,
  connectLiveThread,
  draftsOf,
  lastAnswer,
  signIn,
  type ThreadClient,
  websiteFixture,
} from "../../../test/threads";
import { router } from "../../router";

// Threads run on pi-ai's fake provider, scripted per test, rather than reaching OpenRouter.
vi.mock("../../lib/thread-model", async () => {
  const { testThreadModel } = await import("../../../test/thread-model");
  return { threadModel: testThreadModel };
});

type GitFakes = {
  branches(repo: string): Promise<string[]>;
  commit(repo: string, files: Record<string, string>, message: string): Promise<string>;
};

const fakes = (env as unknown as { RELEASE_FAKES: GitFakes }).RELEASE_FAKES;

afterEach(async () => {
  await abortAllDurableObjects();
  forgetThreadModel();
});

const HERO = `export const hero = "Welcome to Acme";\n`;
const PRICING = `export const pricing = "Plans start at $9";\n`;

/** A website whose `main` holds a block, the platform's `package.json` and its lockfile. */
async function websiteWithCode() {
  const website = await websiteFixture({ home: "Hello" });
  await pushToMain(website.project.uuid, {
    "package.json": `{ "name": "acme", "dependencies": { "camox": "1.0.0" } }\n`,
    "pnpm-lock.yaml": LOCKFILE,
    "src/blocks/hero.tsx": HERO,
  });
  return website;
}

/** A new draft of `website`, started by the fixture member, and its thread, open. */
async function draftThread(website: Awaited<ReturnType<typeof websiteWithCode>>, token: string) {
  const draftId = await startDraft(website.db, website.project.id, website.memberUser.id);
  return { draftId, thread: await connectDraftThread(website.project.id, draftId, token) };
}

/**
 * Has the agent call the tool `name` with `args`, and returns what the tool answered it, as the
 * agent's answer shows it: without a last newline.
 */
async function toolResult(
  thread: ThreadClient,
  name: string,
  args: Parameters<typeof answerWithToolCall>[1],
) {
  answerWithToolCall(name, args);
  answerFrom(({ lastToolResult }) => lastToolResult);
  return lastAnswer(await ask(thread, `Call ${name}`, { keepOpen: true }));
}

describe("the agent writing the website's code", () => {
  it("writes in the draft's own branch, whose reads return the new file, leaving Live's code", async () => {
    const website = await websiteWithCode();
    const token = await signIn(website.db, website.memberUser.id);
    const { draftId, thread } = await draftThread(website, token);

    await toolResult(thread, "write", { path: "src/blocks/pricing.tsx", content: PRICING });

    expect(await toolResult(thread, "read", { path: "src/blocks/pricing.tsx" })).toBe(
      PRICING.trimEnd(),
    );
    expect(await toolResult(thread, "ls", { path: "src/blocks" })).toBe("hero.tsx\npricing.tsx");
    thread.close();

    // Live's code is unchanged, and the draft has its own branch.
    const live = await connectLiveThread(website.project.id, token);
    expect(await toolResult(live, "ls", { path: "src/blocks" })).toBe("hero.tsx");
    live.close();
    expect(await fakes.branches(website.project.uuid)).toEqual(["main", draftId]);
  });

  it("offers no code writes on Live, where a write changes nothing and starts no draft", async () => {
    const website = await websiteWithCode();
    const token = await signIn(website.db, website.memberUser.id);
    const live = await connectLiveThread(website.project.id, token);

    const result = await toolResult(live, "write", {
      path: "src/blocks/pricing.tsx",
      content: PRICING,
    });

    expect(result).not.toBe("");
    expect(await toolResult(live, "ls", { path: "src/blocks" })).toBe("hero.tsx");
    live.close();
    expect(await draftsOf(website)).toEqual([]);
    expect(await fakes.branches(website.project.uuid)).toEqual(["main"]);
  });

  it("still reads its changes in a later turn, after the working copy was evicted", async () => {
    const website = await websiteWithCode();
    const token = await signIn(website.db, website.memberUser.id);
    const { draftId, thread } = await draftThread(website, token);
    const draft = { id: draftId };
    await toolResult(thread, "write", { path: "src/blocks/pricing.tsx", content: PRICING });
    await toolResult(thread, "edit", {
      path: "src/blocks/hero.tsx",
      edits: [{ oldText: "Welcome to Acme", newText: "Welcome back" }],
    });
    await toolResult(thread, "mv", {
      from: "src/blocks/pricing.tsx",
      to: "src/sections/pricing.tsx",
    });
    thread.close();

    await abortAllDurableObjects();

    const later = await connectDraftThread(website.project.id, draft!.id, token);
    expect(await toolResult(later, "read", { path: "src/blocks/hero.tsx" })).toBe(
      `export const hero = "Welcome back";`,
    );
    expect(await toolResult(later, "ls", { path: "src/blocks" })).toBe("hero.tsx");
    expect(await toolResult(later, "read", { path: "src/sections/pricing.tsx" })).toBe(
      PRICING.trimEnd(),
    );
    await toolResult(later, "rm", { path: "src/sections/pricing.tsx" });
    expect(await toolResult(later, "find", { pattern: "*.tsx", path: "src" })).toBe(
      "blocks/hero.tsx",
    );
    later.close();
  });

  it("refuses writes in a development draft, whose code is the developer's own", async () => {
    const website = await websiteWithCode();
    const draftId = await openDevelopmentDraft(
      website.db,
      website.project.id,
      website.memberUser.id,
    );
    const token = await signIn(website.db, website.memberUser.id);
    const thread = await connectDraftThread(website.project.id, DEVELOPMENT_DRAFT, token);

    const result = await toolResult(thread, "write", {
      path: "src/blocks/pricing.tsx",
      content: PRICING,
    });
    thread.close();

    expect(result).toContain("development draft");
    expect(await env.DRAFT_CODE.getByName(draftId).held()).toBe(false);
    expect(await fakes.branches(website.project.uuid)).toEqual(["main"]);
  });

  it("refuses writes beyond the write line, naming the rule, and writes nothing", async () => {
    const website = await websiteWithCode();
    const token = await signIn(website.db, website.memberUser.id);
    const { draftId, thread } = await draftThread(website, token);
    const draft = { id: draftId };
    const allowed = "You may write `src/**/*.{ts,tsx,css}`, except `src/camox/`.";

    // A refused first write gives the draft no working copy.
    expect(
      await toolResult(thread, "write", { path: "vite.config.ts", content: "export {};" }),
    ).toContain(`\`vite.config.ts\` is platform-owned; only Upgrades change it. ${allowed}`);
    expect(await env.DRAFT_CODE.getByName(draftId).held()).toBe(false);
    await toolResult(thread, "write", { path: "src/blocks/pricing.tsx", content: PRICING });

    const platformOwned = (path: string) =>
      `\`${path}\` is platform-owned; only Upgrades change it. ${allowed}`;
    const refusals: [string, Parameters<typeof answerWithToolCall>[1], string][] = [
      ["write", { path: "package.json", content: "{}" }, platformOwned("package.json")],
      ["write", { path: "src/camox/app.ts", content: "" }, platformOwned("src/camox/app.ts")],
      ["write", { path: "public/robots.ts", content: "" }, platformOwned("public/robots.ts")],
      [
        "write",
        { path: "src/logo.png", content: "" },
        `\`src/logo.png\` isn't a TypeScript or CSS file. ${allowed}`,
      ],
      [
        "edit",
        { path: "package.json", edits: [{ oldText: "acme", newText: "evil" }] },
        platformOwned("package.json"),
      ],
      // Both ends of a move are checked.
      ["mv", { from: "package.json", to: "src/package.ts" }, platformOwned("package.json")],
      ["mv", { from: "src/blocks/hero.tsx", to: "hero.tsx" }, platformOwned("hero.tsx")],
      ["rm", { path: "package.json" }, platformOwned("package.json")],
      ["rm", { path: "src/camox/app.ts" }, platformOwned("src/camox/app.ts")],
      // Camox's skills are mounted beside the code, never part of it.
      [
        "write",
        { path: ".camox/skills/camox/SKILL.md", content: "" },
        platformOwned(".camox/skills/camox/SKILL.md"),
      ],
    ];
    for (const [tool, args, refusal] of refusals) {
      expect(await toolResult(thread, tool, args)).toContain(`[error] ${refusal}`);
    }

    expect(await toolResult(thread, "ls", {})).toBe(".camox/\npackage.json\npnpm-lock.yaml\nsrc/");
    expect(await toolResult(thread, "ls", { path: "src" })).toBe("blocks/");
    expect(await toolResult(thread, "ls", { path: "src/blocks" })).toBe("hero.tsx\npricing.tsx");
    expect(await toolResult(thread, "read", { path: "package.json" })).toContain(`"acme"`);
    thread.close();

    // The working copy holds the line itself, whatever reaches it.
    const workingCopy = env.DRAFT_CODE.getByName(draft!.id);
    expect(
      await workingCopy.call({ operation: "writeFile", args: ["/package.json", "{}"] }),
    ).toEqual({
      ok: false,
      error: {
        code: "permission_denied",
        message: platformOwned("package.json"),
        path: "/package.json",
      },
    });
    expect(
      await workingCopy.call({ operation: "remove", args: ["/", { recursive: true }] }),
    ).toMatchObject({ ok: false, error: { code: "permission_denied" } });
    expect(await workingCopy.call({ operation: "readTextFile", args: ["/package.json"] })).toEqual({
      ok: true,
      value: expect.stringContaining(`"acme"`),
    });
  });

  it("gives a draft without code its working copy with its first code write", async () => {
    const website = await websiteWithCode();
    const token = await signIn(website.db, website.memberUser.id);
    const { draftId, thread } = await draftThread(website, token);
    const draft = { id: draftId };
    answerWithScript(`
      const home = await tools.getPage({ path: "/home" });
      await tools.editBlock({ id: home.blocks[0].id, content: { body: "Hi" } });
    `);
    answerNext("Done.");
    await ask(thread, "Say hi", { keepOpen: true });
    expect(await toolResult(thread, "ls", { path: "src/blocks" })).toBe("hero.tsx");

    await toolResult(thread, "write", { path: "src/blocks/pricing.tsx", content: PRICING });

    expect(await toolResult(thread, "ls", { path: "src/blocks" })).toBe("hero.tsx\npricing.tsx");
    thread.close();
    expect((await draftsOf(website)).map(({ id }) => id)).toEqual([draft!.id]);
    expect(await fakes.branches(website.project.uuid)).toEqual(["main", draft!.id]);
  });

  it("starts the draft's code from the copy of main the agent read", async () => {
    const website = await websiteWithCode();
    const token = await signIn(website.db, website.memberUser.id);
    const { thread } = await draftThread(website, token);
    expect(await toolResult(thread, "read", { path: "src/blocks/hero.tsx" })).toBe(HERO.trimEnd());
    // `main` moves, and the copy the agent read hasn't caught up yet.
    await fakes.commit(website.project.uuid, { "src/blocks/hero.tsx": "export {};\n" }, "Moved");

    await toolResult(thread, "write", { path: "src/blocks/pricing.tsx", content: PRICING });

    expect(await toolResult(thread, "read", { path: "src/blocks/hero.tsx" })).toBe(HERO.trimEnd());
    expect(await toolResult(thread, "ls", { path: "src/blocks" })).toBe("hero.tsx\npricing.tsx");
    thread.close();
  });

  it("deletes the draft's branch and working copy when the draft is deleted", async () => {
    const website = await websiteWithCode();
    const token = await signIn(website.db, website.memberUser.id);
    const { draftId, thread } = await draftThread(website, token);
    const draft = { id: draftId };
    await toolResult(thread, "write", { path: "src/blocks/pricing.tsx", content: PRICING });
    thread.close();

    await call(
      router.drafts.delete,
      { projectId: website.project.id },
      { context: createRpcContext(website.db, website.memberUser, { [DRAFT_HEADER]: draft!.id }) },
    );

    expect(await fakes.branches(website.project.uuid)).toEqual(["main"]);
    expect(await storedWorkingCopy(draft!.id)).toEqual({ tables: [], keys: [] });
  });
});

/** What the working copy of the draft `draftId` keeps: the tables and keys in its storage. */
function storedWorkingCopy(draftId: string) {
  return runInDurableObject(env.DRAFT_CODE.getByName(draftId), async (_copy, state) => ({
    tables: state.storage.sql
      .exec<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'",
      )
      .toArray()
      .map(({ name }) => name),
    keys: [...(await state.storage.list()).keys()],
  }));
}
