import { DRAFT_HEADER } from "@camox/api-contract/drafts";
import { call } from "@orpc/server";
import { abortAllDurableObjects } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createRpcContext, startDraft } from "../../../test/fixtures";
import { pushToMain } from "../../../test/pushes";
import { answerFrom, answerWithToolCall, forgetThreadModel } from "../../../test/thread-model";
import {
  ask,
  connectDraftThread,
  signIn,
  type ThreadClient,
  websiteFixture,
} from "../../../test/threads";
import { router } from "../../router";
import { revisionArchiveKey } from "./archive";
import { INFRASTRUCTURE_ATTEMPTS } from "./build";
import { LOG_TAIL_LINES } from "./build-log";
import { ERRORS_SHOWN } from "./result";
import { REVISION_SANDBOX_SLEEP_AFTER } from "./sandbox";

// Threads run on pi-ai's fake provider, scripted per test, rather than reaching OpenRouter.
vi.mock("../../lib/thread-model", async () => {
  const { testThreadModel } = await import("../../../test/thread-model");
  return { threadModel: testThreadModel };
});

/** A build the fake revision sandbox ran: the tree it was given, and the archive it made. */
type RevisionBuild = { sandbox: string; files: Record<string, string>; archive: number[] | null };

type Fakes = {
  readFile(repo: string, ref: string, path: string): Promise<string | null>;
  revisionBuilds(sandbox: string): Promise<RevisionBuild[]>;
  revisionCommands(sandbox: string): Promise<{ command: string }[]>;
  failBuildsOf(marker: string, log: string): Promise<void>;
  crashSandboxes(marker: string, times: number): Promise<void>;
  sandboxDestroyed(sandbox: string): Promise<boolean>;
  sandboxSleepAfter(sandbox: string): Promise<string | undefined>;
  installInImage(lockfile: string | null): Promise<void>;
};

const fakes = (env as unknown as { RELEASE_FAKES: Fakes }).RELEASE_FAKES;

afterEach(async () => {
  await abortAllDurableObjects();
  forgetThreadModel();
});

const HERO = `export const hero = "Welcome to Acme";\n`;
const PRICING = `export const pricing = "Plans start at $9";\n`;
const LOCKFILE = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      camox:
        specifier: 1.0.0
        version: 1.0.0(react@19.3.1)
`;

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

/**
 * Has the agent call the tool `name` with `args`, and returns what the tool answered it. The turn
 * ends with a build of the code it changed, which may send the agent back to work: unscripted,
 * its turn then fails.
 */
async function toolResult(
  thread: ThreadClient,
  name: string,
  args: Parameters<typeof answerWithToolCall>[1],
) {
  let result: string | undefined;
  answerWithToolCall(name, args);
  answerFrom(({ lastToolResult }) => {
    result = lastToolResult;
    return "Done.";
  });
  await ask(thread, `Call ${name}`, { keepOpen: true });
  return result;
}

/**
 * Has the agent of a new draft write `files` and build them in one turn, so the end of the turn
 * builds nothing more, returning what `build` answered it.
 */
async function buildInFirstTurn(files: Record<string, string>) {
  const website = await websiteWithCode();
  const draftId = await startDraft(website.db, website.project.id, website.memberUser.id);
  const thread = await connectDraftThread(
    website.project.id,
    draftId,
    await signIn(website.db, website.memberUser.id),
  );
  for (const [path, content] of Object.entries(files)) {
    answerWithToolCall("write", { path, content });
  }
  let result: string | undefined;
  answerWithToolCall("build", {});
  answerFrom(({ lastToolResult }) => {
    result = lastToolResult;
    return "Built.";
  });
  await ask(thread, "Write and build");
  return { website, draft: { id: draftId }, result };
}

/** A draft whose agent wrote `files`, with its thread open. */
async function draftWithChanges(files: Record<string, string>) {
  const website = await websiteWithCode();
  const token = await signIn(website.db, website.memberUser.id);
  const draftId = await startDraft(website.db, website.project.id, website.memberUser.id);
  const thread = await connectDraftThread(website.project.id, draftId, token);
  for (const [path, content] of Object.entries(files)) {
    await toolResult(thread, "write", { path, content });
  }
  return { website, token, draft: { id: draftId }, thread };
}

/** A file that doesn't build, marked so the fake sandbox fails the build of any tree holding it. */
const broken = (marker: string) => `import { pricing } from "./missing"; // ${marker}\n`;

/** Colors, which Rolldown prints in a sandbox too. */
const grey = (text: string) => `\u001b[38;5;246m${text}\u001b[0m`;

/** The log of a build failing as Vite's does, from the sandbox's workspace. */
const failedBuild = (errors: string[]) => `vite v8.0.0 building client environment for production...
transforming...
✗ Build failed in 1.20s
error during build:
Build failed with ${errors.length} error${errors.length === 1 ? "" : "s"}:

${errors.join("\n")}
    at aggregateBindingErrorsIntoJsError (file:///workspace/website/node_modules/rolldown/dist/error.mjs:49:18)
`;

/** An unresolved import, as Rolldown reports it, with a frame and a hint. */
const unresolved = (
  file: string,
  line: number,
) => `\u001b[31m[UNRESOLVED_IMPORT] \u001b[0mCould not resolve './missing' in ${file}
   ${grey("╭")}${grey("─")}${grey("[")} ${file}:${line}:26 ${grey("]")}
   ${grey("│")}
 ${grey(`${line} │`)} import { pricing } from "./missing";
 ${grey("  │")}                         ─────┬─────
 ${grey("  │")}                              ╰─────── Module not found.
 ${grey("  │")}
 ${grey("  │")} Help: '${file}' is imported by the following path:
 ${grey("  │")}         - ${file}
 ${grey("  │")}         - \0virtual:camox/app
${grey("───╯")}
`;

const build = async (thread: ThreadClient) =>
  JSON.parse((await toolResult(thread, "build", {}))!) as Record<string, unknown>;

describe("the agent's build", () => {
  it("commits a revision on the draft's branch when it passes, with its build in R2", async () => {
    const { website, draft, thread } = await draftWithChanges({
      "src/blocks/pricing.tsx": PRICING,
    });

    const result = await build(thread);
    thread.close();

    expect(result).toEqual({
      ok: true,
      revision: expect.any(String),
      build: [],
      types: [],
      lint: [],
    });
    // The revision is the draft's branch, as the sandbox built it: the website's files, without
    // Git's or the references mounted beside them.
    const repo = website.project.uuid;
    expect(await fakes.readFile(repo, draft.id, "src/blocks/pricing.tsx")).toBe(PRICING);
    const [built, ...others] = await fakes.revisionBuilds(draft.id);
    expect(others).toEqual([]);
    expect(Object.keys(built!.files).sort()).toEqual([
      "package.json",
      "pnpm-lock.yaml",
      "src/blocks/hero.tsx",
      "src/blocks/pricing.tsx",
    ]);
    expect(built!.files["src/blocks/pricing.tsx"]).toBe(PRICING);
    const archive = await env.REVISION_BUILDS.get(
      revisionArchiveKey({ project: repo, draft: draft.id, revision: result.revision as string }),
    );
    expect([...new Uint8Array(await archive!.arrayBuffer())]).toEqual(built!.archive);
  });

  it("returns a failing build's errors, with their file and line, and commits nothing", async () => {
    const marker = crypto.randomUUID();
    await fakes.failBuildsOf(
      marker,
      failedBuild([
        unresolved("src/blocks/pricing.tsx", 3),
        `[plugin camox]
RolldownError: src/blocks/hero.tsx imports "node:fs", which a hosted project can't import. It can import files in src/, camox's public entry points and the packages package.json lists in dependencies.
    at error (file:///workspace/website/node_modules/rolldown/dist/logs.mjs:166:24)
    at PluginContextImpl.resolveId (file:///workspace/website/node_modules/camox/dist/vite.js:315:29)`,
        // A build check's error at a place in its file, as the hosted build prints it.
        `[plugin camox] /workspace/website/src/blocks/faq.tsx:5:6
RolldownError: src/blocks/faq.tsx defines the block "questions", but its file is named "faq": a block's file is named after its id. Rename the file to questions.tsx or the id to "faq".
4: export const block = createBlock({
5:   id: "questions",
         ^
6:   title: "FAQ",
    at error (file:///workspace/website/node_modules/rolldown/dist/logs.mjs:166:24)
    at TransformPluginContextImpl.transform (file:///workspace/website/node_modules/camox/dist/vite.js:373:28)`,
      ]),
    );
    const { website, draft, thread } = await draftWithChanges({
      "src/blocks/pricing.tsx": broken(marker),
    });

    const result = await build(thread);
    thread.close();

    expect(result).toEqual({
      ok: false,
      build: [
        {
          file: "src/blocks/pricing.tsx",
          line: 3,
          column: 26,
          message: "Could not resolve './missing' in src/blocks/pricing.tsx",
          frame: expect.stringContaining(`3 │ import { pricing } from "./missing";`),
        },
        {
          file: "src/blocks/hero.tsx",
          line: 0,
          column: 0,
          message: expect.stringMatching(/^src\/blocks\/hero\.tsx imports "node:fs"/),
          frame: "",
        },
        {
          file: "src/blocks/faq.tsx",
          line: 5,
          column: 6,
          message: expect.stringMatching(/^src\/blocks\/faq\.tsx defines the block "questions"/),
          frame: expect.stringContaining(`5:   id: "questions",`),
        },
      ],
      types: [],
      lint: [],
    });
    expect(result.build).toMatchObject([
      { frame: expect.stringContaining("Module not found.") },
      {},
      {},
    ]);
    expect(await fakes.readFile(website.project.uuid, draft.id, "src/blocks/pricing.tsx")).toBe(
      null,
    );
    const builds = await env.REVISION_BUILDS.list({ prefix: `${website.project.uuid}/` });
    expect(builds.objects).toEqual([]);
  });

  it("caps a long list of errors, with their total", async () => {
    const marker = crypto.randomUUID();
    const total = ERRORS_SHOWN + 2;
    const errors = Array.from({ length: total }, (_, at) =>
      unresolved("src/blocks/pricing.tsx", at + 1),
    );
    await fakes.failBuildsOf(marker, failedBuild(errors));
    const { thread } = await draftWithChanges({ "src/blocks/pricing.tsx": broken(marker) });

    const result = await build(thread);
    thread.close();

    expect(result).toMatchObject({ ok: false, truncated: { build: total } });
    expect((result.build as { line: number }[]).map(({ line }) => line)).toEqual(
      Array.from({ length: ERRORS_SHOWN }, (_, at) => at + 1),
    );
  });

  it("gives back the end of a log it can't read the errors of", async () => {
    const marker = crypto.randomUUID();
    const lines = Array.from({ length: LOG_TAIL_LINES * 2 }, (_, at) => `line ${at + 1}`);
    const last =
      "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory";
    await fakes.failBuildsOf(marker, `${lines.join("\n")}\n${last}\n`);
    const { thread } = await draftWithChanges({ "src/blocks/pricing.tsx": broken(marker) });

    const result = await build(thread);
    thread.close();

    expect(result).toMatchObject({ ok: false });
    const [error, ...others] = result.build as { file: string; message: string }[];
    expect(others).toEqual([]);
    expect(error!.file).toBe("");
    const tail = error!.message.split("\n");
    expect(tail).toHaveLength(LOG_TAIL_LINES);
    expect(tail.at(-1)).toBe(last);
    expect(tail[0]).toBe(lines.at(-(LOG_TAIL_LINES - 1)));
  });

  it("returns the revision a tree already has without building it again", async () => {
    const { website, token, draft, thread } = await draftWithChanges({
      "src/blocks/pricing.tsx": PRICING,
    });
    const first = await build(thread);
    thread.close();

    // As a call replayed in a later isolate would.
    const later = await connectDraftThread(website.project.id, draft.id, token);
    const again = await build(later);
    later.close();

    expect(again).toEqual(first);
    expect(await fakes.revisionBuilds(draft.id)).toHaveLength(1);
  });

  it("installs again only when the lockfile changed", async () => {
    const { draft, thread } = await draftWithChanges({ "src/blocks/pricing.tsx": PRICING });
    await build(thread);
    await toolResult(thread, "write", { path: "src/blocks/hero.tsx", content: PRICING });

    await build(thread);
    thread.close();

    const installs = (await fakes.revisionCommands(draft.id)).filter(({ command }) =>
      command.includes("pnpm install --frozen-lockfile"),
    );
    expect(installs).toHaveLength(1);
    expect(await fakes.revisionBuilds(draft.id)).toHaveLength(2);
    expect(await fakes.sandboxSleepAfter(draft.id)).toBe(REVISION_SANDBOX_SLEEP_AFTER);
  });

  it("starts the sandbox as the agent first writes code, installing before it builds", async () => {
    const { draft } = await buildInFirstTurn({
      "src/blocks/pricing.tsx": PRICING,
      "src/blocks/faq.tsx": `export const faq = "Ask us";\n`,
    });

    const commands = (await fakes.revisionCommands(draft.id)).map(({ command }) => command);
    const built = commands.findIndex((command) => command.includes("vp build"));
    const beforeBuild = commands.slice(0, built);
    const extracts = beforeBuild.flatMap((command, at) =>
      command.includes("tar -xf") ? [at] : [],
    );
    const installs = beforeBuild.flatMap((command, at) =>
      command.includes("pnpm install") ? [at] : [],
    );
    // Its first write started the sandbox, once for both writes, and the build found the install.
    expect(extracts).toHaveLength(2);
    expect(installs).toHaveLength(1);
    expect(installs[0]).toBeGreaterThan(extracts[0]!);
    expect(installs[0]).toBeLessThan(extracts[1]!);
  });

  it("doesn't install in a new sandbox whose image installed the lockfile", async () => {
    await fakes.installInImage(LOCKFILE);
    try {
      const { draft } = await buildInFirstTurn({ "src/blocks/pricing.tsx": PRICING });

      const commands = await fakes.revisionCommands(draft.id);
      expect(commands.filter(({ command }) => command.includes("pnpm install"))).toEqual([]);
      expect(await fakes.revisionBuilds(draft.id)).toHaveLength(1);
    } finally {
      await fakes.installInImage(null);
    }
  });

  it("installs in a new sandbox whose image installed another lockfile", async () => {
    await fakes.installInImage(`${LOCKFILE}# the Template's\n`);
    try {
      const { draft } = await buildInFirstTurn({ "src/blocks/pricing.tsx": PRICING });

      const commands = await fakes.revisionCommands(draft.id);
      expect(commands.filter(({ command }) => command.includes("pnpm install"))).toHaveLength(1);
    } finally {
      await fakes.installInImage(null);
    }
  });

  it("retries a sandbox that fails, without telling the agent", async () => {
    const marker = crypto.randomUUID();
    const pricing = `${PRICING}// ${marker}\n`;
    await fakes.crashSandboxes(marker, INFRASTRUCTURE_ATTEMPTS - 1);
    const { website, draft, result } = await buildInFirstTurn({
      "src/blocks/pricing.tsx": pricing,
    });

    expect(JSON.parse(result!)).toMatchObject({ ok: true, build: [] });
    expect(await fakes.readFile(website.project.uuid, draft.id, "src/blocks/pricing.tsx")).toBe(
      pricing,
    );
  });

  it("never reports a sandbox that keeps failing as a build error", async () => {
    // The agent's build fails, then the end of its turn's.
    const marker = crypto.randomUUID();
    await fakes.crashSandboxes(marker, 2 * INFRASTRUCTURE_ATTEMPTS);
    const {
      website,
      draft,
      result: answer,
    } = await buildInFirstTurn({
      "src/blocks/pricing.tsx": `${PRICING}// ${marker}\n`,
    });

    expect(answer).toContain("a problem on its side, not in your code");
    expect(answer).not.toContain("Container crashed");
    expect(await fakes.readFile(website.project.uuid, draft.id, "src/blocks/pricing.tsx")).toBe(
      null,
    );
  });

  it("deletes the draft's builds and its sandbox when the draft is deleted", async () => {
    const { website, draft, thread } = await draftWithChanges({
      "src/blocks/pricing.tsx": PRICING,
    });
    await build(thread);
    thread.close();

    await call(
      router.drafts.delete,
      { projectId: website.project.id },
      { context: createRpcContext(website.db, website.memberUser, { [DRAFT_HEADER]: draft.id }) },
    );

    const builds = await env.REVISION_BUILDS.list({ prefix: `${website.project.uuid}/` });
    expect(builds.objects).toEqual([]);
    expect(await fakes.sandboxDestroyed(draft.id)).toBe(true);
  });
});
