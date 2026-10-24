import { abortAllDurableObjects, createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { pushToMain } from "../../../test/pushes";
import {
  answerFrom,
  answerWithToolCall,
  answerWithToolCallFrom,
  forgetThreadModel,
  type ModelRequest,
} from "../../../test/thread-model";
import {
  ask,
  connectLiveThread,
  draftsOf,
  lastAnswer,
  signIn,
  type ThreadClient,
  websiteFixture,
} from "../../../test/threads";
import type { Bindings } from "../../types";
import worker from "../../worker";
import { type FontSearch, FONTS_SHOWN, FONTS_SNAPSHOT_KEY } from "./catalog";

// Threads run on pi-ai's fake provider, scripted per test, rather than reaching OpenRouter.
vi.mock("../../lib/thread-model", async () => {
  const { testThreadModel } = await import("../../../test/thread-model");
  return { threadModel: testThreadModel };
});

type Fakes = { listGoogleFonts(families: Record<string, unknown>[]): Promise<void> };

const fakes = (env as unknown as { RELEASE_FAKES: Fakes }).RELEASE_FAKES;

afterEach(async () => {
  await abortAllDurableObjects();
  forgetThreadModel();
});

/** Families as the Google Fonts Developer API lists them, most popular first. */
const ARCHIVO = {
  family: "Archivo",
  category: "sans-serif",
  variants: ["regular", "italic"],
  subsets: ["latin", "latin-ext", "vietnamese"],
  version: "v19",
  lastModified: "2025-09-08",
  files: { regular: "https://fonts.gstatic.com/s/archivo/v19/archivo.ttf" },
  menu: "https://fonts.gstatic.com/s/archivo/v19/archivo-menu.ttf",
  axes: [
    { tag: "wdth", start: 62, end: 125 },
    { tag: "wght", start: 100, end: 900 },
  ],
};
const PLAYFAIR_DISPLAY = {
  family: "Playfair Display",
  category: "serif",
  variants: ["regular", "italic"],
  subsets: ["latin"],
  version: "v37",
  lastModified: "2025-09-08",
  files: { regular: "https://fonts.gstatic.com/s/playfairdisplay/v37/playfair.ttf" },
  menu: "https://fonts.gstatic.com/s/playfairdisplay/v37/playfair-menu.ttf",
  axes: [{ tag: "wght", start: 400, end: 900 }],
};
const PLAYFAIR_DISPLAY_SC = {
  family: "Playfair Display SC",
  category: "serif",
  variants: ["regular", "italic", "700", "700italic", "900", "900italic"],
  subsets: ["latin"],
  version: "v17",
  lastModified: "2025-09-08",
  files: { regular: "https://fonts.gstatic.com/s/playfairdisplaysc/v17/sc.ttf" },
  menu: "https://fonts.gstatic.com/s/playfairdisplaysc/v17/sc-menu.ttf",
};
const ABRIL_FATFACE = {
  family: "Abril Fatface",
  category: "display",
  variants: ["regular"],
  subsets: ["latin"],
  version: "v24",
  lastModified: "2025-09-08",
  files: { regular: "https://fonts.gstatic.com/s/abrilfatface/v24/abril.ttf" },
  menu: "https://fonts.gstatic.com/s/abrilfatface/v24/abril-menu.ttf",
};

/** Runs the API's scheduled job, as its daily cron trigger would, until it's done. */
async function runScheduledJob() {
  await worker.scheduled(createScheduledController(), env as Bindings);
}

/** A website's Live thread, open, with a member signed in. */
async function liveThread() {
  const website = await websiteFixture({ home: "Hello" });
  const token = await signIn(website.db, website.memberUser.id);
  return { website, token, thread: await connectLiveThread(website.project.id, token) };
}

/** Has the agent call the tool `name` with `args`, and returns what the tool answered it. */
async function toolResult(
  thread: ThreadClient,
  name: string,
  args: Parameters<typeof answerWithToolCall>[1],
) {
  answerWithToolCall(name, args);
  answerFrom(({ lastToolResult }) => lastToolResult);
  return lastAnswer(await ask(thread, `Call ${name}`, { keepOpen: true }));
}

const searchFonts = async (thread: ThreadClient, args: Record<string, string>) =>
  JSON.parse((await toolResult(thread, "searchFonts", args))!) as Record<string, unknown>;

describe("searchFonts", () => {
  it("finds families by name in the snapshot the scheduled job took", async () => {
    await fakes.listGoogleFonts([ARCHIVO, PLAYFAIR_DISPLAY, PLAYFAIR_DISPLAY_SC, ABRIL_FATFACE]);
    await runScheduledJob();
    const { thread } = await liveThread();

    const result = await searchFonts(thread, { query: "playfair" });
    thread.close();

    // Links as Google Fonts' own embed code writes them.
    expect(result).toEqual({
      families: [
        {
          family: "Playfair Display",
          category: "serif",
          axes: [{ tag: "wght", start: 400, end: 900 }],
          italic: true,
          link: "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400..900;1,400..900&display=swap",
        },
        {
          family: "Playfair Display SC",
          category: "serif",
          weights: [400, 700, 900],
          italic: true,
          link: "https://fonts.googleapis.com/css2?family=Playfair+Display+SC:ital,wght@0,400;0,700;0,900;1,400;1,700;1,900&display=swap",
        },
      ],
      total: 2,
    });
  });

  it("finds families by category, most popular first", async () => {
    await fakes.listGoogleFonts([ARCHIVO, ABRIL_FATFACE, PLAYFAIR_DISPLAY]);
    await runScheduledJob();
    const { thread } = await liveThread();

    const display = await searchFonts(thread, { category: "display" });
    const sans = await searchFonts(thread, { query: "arch", category: "sans-serif" });
    const none = await searchFonts(thread, { query: "arch", category: "serif" });
    thread.close();

    expect(display).toEqual({
      families: [
        {
          family: "Abril Fatface",
          category: "display",
          weights: [400],
          italic: false,
          link: "https://fonts.googleapis.com/css2?family=Abril+Fatface&display=swap",
        },
      ],
      total: 1,
    });
    // The link apps/landing's Document has.
    expect(sans).toEqual({
      families: [
        {
          family: "Archivo",
          category: "sans-serif",
          axes: ARCHIVO.axes,
          italic: true,
          link: "https://fonts.googleapis.com/css2?family=Archivo:ital,wght@0,100..900;1,100..900&display=swap",
        },
      ],
      total: 1,
    });
    expect(none).toEqual({ families: [], total: 0 });
  });

  it("returns the most popular matches, with how many matched", async () => {
    const serifs = Array.from({ length: FONTS_SHOWN + 1 }, (_, index) => ({
      ...PLAYFAIR_DISPLAY,
      family: `Serif ${index}`,
    }));
    await fakes.listGoogleFonts([ARCHIVO, ...serifs]);
    await runScheduledJob();
    const { thread } = await liveThread();

    const result = (await searchFonts(thread, { category: "serif" })) as {
      families: { family: string }[];
      total: number;
    };
    thread.close();

    expect(result.families.map(({ family }) => family)).toEqual(
      serifs.slice(0, FONTS_SHOWN).map(({ family }) => family),
    );
    expect(result.total).toBe(FONTS_SHOWN + 1);
  });
});

const HANKEN_GROTESK_LINK =
  "https://fonts.googleapis.com/css2?family=Hanken+Grotesk:ital,wght@0,100..900;1,100..900&display=swap";

/** The Template's Document: its font is a Google Fonts link. */
const DOCUMENT = `import { defineDocument } from "camox/document";

export default defineDocument({
  htmlAttrs: { lang: "en" },
  title: "Acme",
  meta: [{ name: "viewport", content: "width=device-width, initial-scale=1" }],
  link: [
    { rel: "preconnect", href: "https://fonts.googleapis.com" },
    { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "anonymous" },
    { rel: "stylesheet", href: "${HANKEN_GROTESK_LINK}" },
  ],
});
`;

/** The Template's Theme tokens for fonts: the family's name. */
const STYLES = `@import "tailwindcss";

@theme {
  --font-heading: "Hanken Grotesk", ui-sans-serif, system-ui, sans-serif;
  --font-body: "Hanken Grotesk", ui-sans-serif, system-ui, sans-serif;
}
`;

const LOCKFILE = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      camox:
        specifier: 1.0.0
        version: 1.0.0(react@19.3.1)
`;

type GitFakes = { readFile(repo: string, ref: string, path: string): Promise<string | null> };

describe("a font the agent picks", () => {
  it("is a Google Fonts link in the Document and a Theme token, and the build passes", async () => {
    await fakes.listGoogleFonts([ARCHIVO, PLAYFAIR_DISPLAY]);
    await runScheduledJob();
    const website = await websiteFixture({ home: "Hello" });
    await pushToMain(website.project.uuid, {
      "package.json": `{ "name": "acme", "dependencies": { "camox": "1.0.0" } }\n`,
      "pnpm-lock.yaml": LOCKFILE,
      "src/document.ts": DOCUMENT,
      "src/styles.css": STYLES,
    });
    const token = await signIn(website.db, website.memberUser.id);
    const thread = await connectLiveThread(website.project.id, token);

    // The agent looks the family up, then adds its link and names it in the heading token.
    answerWithToolCall("searchFonts", { query: "Playfair Display", category: "serif" });
    const linkFound = ({ lastToolResult }: ModelRequest) =>
      (JSON.parse(lastToolResult) as FontSearch).families[0]!.link;
    let link = "";
    answerWithToolCallFrom("edit", (request) => {
      link = linkFound(request);
      return {
        path: "src/document.ts",
        edits: [
          {
            oldText: `    { rel: "stylesheet", href: "${HANKEN_GROTESK_LINK}" },\n`,
            newText:
              `    { rel: "stylesheet", href: "${HANKEN_GROTESK_LINK}" },\n` +
              `    { rel: "stylesheet", href: "${link}" },\n`,
          },
        ],
      };
    });
    answerWithToolCall("edit", {
      path: "src/styles.css",
      edits: [
        {
          oldText: `--font-heading: "Hanken Grotesk", ui-sans-serif`,
          newText: `--font-heading: "Playfair Display", ui-serif`,
        },
      ],
    });
    answerWithToolCall("build", {});
    answerFrom(({ lastToolResult }) => lastToolResult);
    const build = JSON.parse(
      lastAnswer(await ask(thread, "Use Playfair Display for the headings"))!,
    ) as Record<string, unknown>;

    expect(build).toMatchObject({ ok: true, revision: expect.any(String) });
    expect(link).toBe(
      "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400..900;1,400..900&display=swap",
    );
    const [draft] = await draftsOf(website);
    const git = (env as unknown as { RELEASE_FAKES: GitFakes }).RELEASE_FAKES;
    const repo = website.project.uuid;
    expect(await git.readFile(repo, draft!.id, "src/document.ts")).toContain(
      `{ rel: "stylesheet", href: "${link}" }`,
    );
    expect(await git.readFile(repo, draft!.id, "src/styles.css")).toContain(
      `--font-heading: "Playfair Display", ui-serif, system-ui, sans-serif;`,
    );
  });
});

describe("the fonts snapshot", () => {
  it("is refreshed by the scheduled job", async () => {
    await fakes.listGoogleFonts([PLAYFAIR_DISPLAY]);
    await runScheduledJob();
    await fakes.listGoogleFonts([PLAYFAIR_DISPLAY_SC]);
    const { thread } = await liveThread();
    const before = await searchFonts(thread, { query: "playfair" });

    await runScheduledJob();
    const after = await searchFonts(thread, { query: "playfair" });
    thread.close();

    expect(before).toMatchObject({ families: [{ family: "Playfair Display" }], total: 1 });
    expect(after).toMatchObject({ families: [{ family: "Playfair Display SC" }], total: 1 });
  });

  it("is taken by the first search when the scheduled job hasn't run yet", async () => {
    await env.REVISION_BUILDS.delete(FONTS_SNAPSHOT_KEY);
    await fakes.listGoogleFonts([PLAYFAIR_DISPLAY]);
    const { thread } = await liveThread();

    const result = await searchFonts(thread, { query: "playfair" });
    thread.close();

    expect(result).toMatchObject({ families: [{ family: "Playfair Display" }], total: 1 });
  });
});
