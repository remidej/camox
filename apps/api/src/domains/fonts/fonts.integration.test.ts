import { abortAllDurableObjects, createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { startDraft } from "../../../test/fixtures";
import {
  answerFrom,
  answerWithCodeRequest,
  answerWithToolCall,
  forgetThreadModel,
} from "../../../test/thread-model";
import {
  ask,
  connectDraftThread,
  lastAnswer,
  signIn,
  type ThreadClient,
  websiteFixture,
} from "../../../test/threads";
import type { Bindings } from "../../types";
import worker from "../../worker";
import { FONTS_SHOWN, FONTS_SNAPSHOT_KEY } from "./catalog";

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

/** The thread of a new draft of a website, open, with a member signed in. */
async function draftThread() {
  const website = await websiteFixture({ home: "Hello" });
  const token = await signIn(website.db, website.memberUser.id);
  const draftId = await startDraft(website.db, website.project.id, website.memberUser.id);
  return { website, token, thread: await connectDraftThread(website.project.id, draftId, token) };
}

/** Has the Code Agent call the tool `name` with `args`, and returns what the tool answered it. */
async function toolResult(
  thread: ThreadClient,
  name: string,
  args: Parameters<typeof answerWithToolCall>[1],
) {
  answerWithCodeRequest();
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
    const { thread } = await draftThread();

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
    const { thread } = await draftThread();

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
    const { thread } = await draftThread();

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

describe("the fonts snapshot", () => {
  it("is refreshed by the scheduled job", async () => {
    await fakes.listGoogleFonts([PLAYFAIR_DISPLAY]);
    await runScheduledJob();
    await fakes.listGoogleFonts([PLAYFAIR_DISPLAY_SC]);
    const { thread } = await draftThread();
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
    const { thread } = await draftThread();

    const result = await searchFonts(thread, { query: "playfair" });
    thread.close();

    expect(result).toMatchObject({ families: [{ family: "Playfair Display" }], total: 1 });
  });
});
