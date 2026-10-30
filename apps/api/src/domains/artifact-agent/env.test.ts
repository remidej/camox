import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import { createEditTool } from "@earendil-works/pi-durable/tools";
import { describe, expect, it } from "vite-plus/test";

import { MemoryFs } from "../../lib/memory-fs";
import { codeEnv } from "../code/env";
import { ARTIFACT_PATH, type ArtifactFile, artifactEnv, artifactWriteOf } from "./env";

const ORBIT = `<!doctype html>\n<title>Orbit</title>\n<script>\nconst speed = 1;\n</script>\n`;

/** An Artifact Agent's environment over a website whose code holds `src/styles.css`. */
async function fixture({ refuse }: { refuse?: string } = {}) {
  const fs = new MemoryFs();
  await fs.promises.mkdir("/src");
  await fs.promises.writeFile("/src/styles.css", ":root { --brand: red; }");
  const code = codeEnv(fs, { cwd: "/", writable: () => undefined });
  const stored = { source: ORBIT, writes: 0 };
  const file: ArtifactFile = {
    read: async () => stored.source,
    write: async (source) => {
      if (refuse) throw new Error(refuse);
      stored.source = source;
      stored.writes++;
      return { warnings: source.includes("<title>") ? [] : ["The source has no <title>"] };
    },
  };
  return { env: artifactEnv(code, file, "artifact:test"), fs, stored };
}

const context = { abortSignal: undefined } as Parameters<
  ReturnType<typeof createEditTool>["execute"]
>[2];

/** Runs Pi's own `edit` on `env`, as an Artifact Agent's call does. */
const edit = (env: Awaited<ReturnType<typeof fixture>>["env"], oldText: string, newText: string) =>
  createEditTool().execute(
    { path: ARTIFACT_PATH, edits: [{ oldText, newText }] },
    { env } as unknown as ToolExecutionApi,
    context,
  );

describe("an Artifact Agent's environment", () => {
  it("shows the artifact's source beside the code, which it reads through", async () => {
    const { env } = await fixture();

    const source = await env.readTextFile(ARTIFACT_PATH, context);
    const styles = await env.readTextFile("src/styles.css", context);
    const root = await env.listDir("/", context);

    expect(source).toEqual({ ok: true, value: ORBIT });
    expect(styles).toEqual({ ok: true, value: ":root { --brand: red; }" });
    expect(root.ok && root.value.map(({ name }) => name).toSorted()).toEqual([
      "artifact.html",
      "src",
    ]);
  });

  it("writes an edit of the source through, the rest of it unchanged", async () => {
    const { env, stored } = await fixture();

    await edit(env, "const speed = 1;", "const speed = 0.5;");

    expect(stored.source).toBe(ORBIT.replace("speed = 1", "speed = 0.5"));
    expect(await env.readTextFile(ARTIFACT_PATH, context)).toEqual({
      ok: true,
      value: stored.source,
    });
  });

  it("keeps a write's warnings for the call", async () => {
    const { env } = await fixture();

    await edit(env, "<title>Orbit</title>\n", "");

    expect(artifactWriteOf(env)).toEqual({ warnings: ["The source has no <title>"] });
  });

  it("keeps the reason a write was refused, leaving the source as it was", async () => {
    const { env } = await fixture({ refuse: "Artifact source is larger than 256 KB." });

    await expect(edit(env, "speed = 1", "speed = 2")).rejects.toThrow();

    expect(artifactWriteOf(env)).toEqual({ refused: "Artifact source is larger than 256 KB." });
    expect(await env.readTextFile(ARTIFACT_PATH, context)).toEqual({ ok: true, value: ORBIT });
  });

  it("refuses every write of the code, and every change of the source but a whole write", async () => {
    const { env, fs, stored } = await fixture();

    const results = [
      await env.writeFile("/src/styles.css", "body {}", context),
      await env.writeFile("src/new.ts", "", context),
      await env.remove("/src/styles.css", undefined, context),
      await env.appendFile(ARTIFACT_PATH, "<p>more</p>", context),
      await env.remove(ARTIFACT_PATH, undefined, context),
    ];

    for (const result of results) expect(result).toMatchObject({ ok: false });
    expect(results[0]).toMatchObject({ error: { message: expect.stringContaining("only read") } });
    expect(await fs.promises.readFile("/src/styles.css", "utf8")).toBe(":root { --brand: red; }");
    expect(stored).toEqual({ source: ORBIT, writes: 0 });
  });
});
