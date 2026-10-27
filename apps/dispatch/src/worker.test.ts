import { describe, expect, it, onTestFinished, vi } from "vite-plus/test";

import {
  API_URL,
  ARCHIVE_KEY,
  archived,
  BUILD,
  context,
  DRAFT,
  fakeBucket,
  fakeLoader,
  definitionSet,
  PRICING_CSS,
  PROJECT,
  REVISION,
  revision,
} from "../test/fakes";
import { LIVE_SCRIPT_TTL_MS } from "./live-script";
import { PREVIEW_ANSWER_TTL_MS } from "./previews";
import worker, { CamoxRevisions, type Env } from "./worker";

const OTHER_PROJECT = "0b8e6a4f-0000-4000-8000-000000000000";

type UserWorker = (request: Request) => Response | Promise<Response>;

/**
 * The bindings as Cloudflare gives them, backed by a plain slug map, the user Workers deployed so
 * far, and the API naming the publish's Worker that serves a project, if any (`liveScripts`).
 */
function fakeEnv({
  slugs = {},
  workers = {},
  liveScripts = {},
}: {
  slugs?: Record<string, string>;
  workers?: Record<string, UserWorker>;
  liveScripts?: Record<string, string>;
}) {
  const asked: string[] = [];
  const env = {
    API: {
      liveScript: async ({ project }: { project: string }) => {
        asked.push(project);
        return liveScripts[project] ?? null;
      },
    },
    liveScriptsAsked: asked,
    PROJECT_SLUGS: {
      get: async (key: string) => slugs[key] ?? null,
    },
    DISPATCHER: {
      get: (name: string) => {
        const userWorker = workers[name];
        if (!userWorker) throw new Error("Worker not found.");
        return { fetch: async (request: Request) => userWorker(request) };
      },
    },
  };
  return env as unknown as Env;
}

const ACME_UUID = "5f0c8f6e-2d3b-4a7e-9c1d-0b8e6a4f2c11";
/** A publish's own Worker of Acme's, as the API names it. */
const PUBLISHED = `${ACME_UUID}-publish-6b3e0a52-8f0d-4f0e-9a51-1c2d3e4f5a6b`;

/** The projects dispatch asked the API which Worker serves. */
const asked = (env: Env) => (env as unknown as { liveScriptsAsked: string[] }).liveScriptsAsked;

describe("dispatch Worker", () => {
  it("serves a project's website from the user Worker named after its UUID", async () => {
    const env = fakeEnv({
      slugs: { acme: ACME_UUID },
      workers: {
        [ACME_UUID]: (request) => new Response(`acme website at ${new URL(request.url).pathname}`),
        "0b8e6a4f-0000-4000-8000-000000000000": () => new Response("another website"),
      },
    });

    const response = await worker.fetch(
      new Request("https://acme.camox.site/pricing"),
      env,
      context(env),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("acme website at /pricing");
  });

  it("answers an unknown slug with a not-found page", async () => {
    const env = fakeEnv({
      slugs: { acme: ACME_UUID },
      workers: { [ACME_UUID]: () => new Response("acme website") },
    });

    const response = await worker.fetch(
      new Request("https://globex.camox.site/"),
      env,
      context(env),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toMatch(/^text\/html/);
    expect(await response.text()).toContain("not found");
  });

  // Universal SSL only covers first-level subdomains, so a slug is exactly one label under camox.site.
  it.each([
    ["a deeper subdomain", "https://www.acme.camox.site/"],
    ["the bare domain", "https://camox.site/"],
    ["another domain", "https://acme.example.com/"],
  ])("answers %s with a not-found page, even when a label matches a slug", async (_, url) => {
    const env = fakeEnv({
      slugs: { acme: ACME_UUID, www: ACME_UUID, camox: ACME_UUID },
      workers: { [ACME_UUID]: () => new Response("acme website") },
    });

    const response = await worker.fetch(new Request(url), env, context(env));

    expect(response.status).toBe(404);
  });

  it("tells visitors a project's website is being set up until its user Worker is deployed", async () => {
    const env = fakeEnv({ slugs: { acme: ACME_UUID } });

    const response = await worker.fetch(new Request("https://acme.camox.site/"), env, context(env));

    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toMatch(/^text\/html/);
    expect(await response.text()).toContain("This site is being set up");
  });

  it("also recognizes a missing user Worker when the namespace reports it on fetch", async () => {
    const env = fakeEnv({ slugs: { acme: ACME_UUID } });
    env.DISPATCHER.get = () =>
      ({
        fetch: async () => {
          throw new Error("Worker not found.");
        },
      }) as unknown as Fetcher;

    const response = await worker.fetch(new Request("https://acme.camox.site/"), env, context(env));

    expect(await response.text()).toContain("This site is being set up");
  });

  it("serves a website from the publish's Worker the API names", async () => {
    const env = fakeEnv({
      slugs: { acme: ACME_UUID },
      workers: {
        [ACME_UUID]: () => new Response("the release's code"),
        [PUBLISHED]: () => new Response("the publish's code"),
      },
      liveScripts: { [ACME_UUID]: PUBLISHED },
    });

    const response = await worker.fetch(new Request("https://acme.camox.site/"), env, context(env));

    expect(await response.text()).toBe("the publish's code");
  });

  it("serves the project's Worker once the publish's Worker the API named is gone", async () => {
    const env = fakeEnv({
      slugs: { acme: ACME_UUID },
      workers: {
        [ACME_UUID]: async (request) => new Response(`the release's code: ${await request.text()}`),
      },
      liveScripts: { [ACME_UUID]: PUBLISHED },
    });

    const response = await worker.fetch(
      new Request("https://acme.camox.site/contact", { method: "POST", body: "hello" }),
      env,
      context(env),
    );

    expect(await response.text()).toBe("the release's code: hello");
  });

  it("asks the API once for a burst of requests, and again once its answer is older than it's kept", async () => {
    vi.useFakeTimers();
    onTestFinished(() => void vi.useRealTimers());
    const liveScripts: Record<string, string> = {};
    const env = fakeEnv({
      slugs: { acme: ACME_UUID },
      workers: {
        [ACME_UUID]: () => new Response("the release's code"),
        [PUBLISHED]: () => new Response("the publish's code"),
      },
      liveScripts,
    });
    const visit = async () =>
      (await worker.fetch(new Request("https://acme.camox.site/"), env, context(env))).text();

    expect(await Promise.all([visit(), visit(), visit()])).toEqual(
      Array(3).fill("the release's code"),
    );
    // A publish points Live at its Worker.
    liveScripts[ACME_UUID] = PUBLISHED;
    expect(await visit()).toBe("the release's code");
    expect(asked(env)).toHaveLength(1);

    vi.advanceTimersByTime(LIVE_SCRIPT_TTL_MS + 1);
    expect(await visit()).toBe("the publish's code");
    expect(asked(env)).toHaveLength(2);
  });

  it("keeps serving the Worker the API last named while it can't answer", async () => {
    vi.useFakeTimers();
    onTestFinished(() => void vi.useRealTimers());
    const env = fakeEnv({
      slugs: { acme: ACME_UUID },
      workers: {
        [ACME_UUID]: () => new Response("the release's code"),
        [PUBLISHED]: () => new Response("the publish's code"),
      },
      liveScripts: { [ACME_UUID]: PUBLISHED },
    });
    const visit = async () =>
      (await worker.fetch(new Request("https://acme.camox.site/"), env, context(env))).text();
    expect(await visit()).toBe("the publish's code");

    env.API.liveScript = async () => {
      throw new Error("Network connection lost.");
    };
    vi.advanceTimersByTime(LIVE_SCRIPT_TTL_MS + 1);

    expect(await visit()).toBe("the publish's code");
  });

  it("serves the project's Worker when the API can't answer and never did", async () => {
    const env = fakeEnv({
      slugs: { acme: ACME_UUID },
      workers: { [ACME_UUID]: () => new Response("the release's code") },
    });
    env.API.liveScript = async () => {
      throw new Error("Network connection lost.");
    };

    const response = await worker.fetch(new Request("https://acme.camox.site/"), env, context(env));

    expect(await response.text()).toBe("the release's code");
  });

  it("lets other user Worker failures through", async () => {
    const env = fakeEnv({
      slugs: { acme: ACME_UUID },
      workers: {
        [ACME_UUID]: () => {
          throw new Error("Cannot read properties of undefined");
        },
      },
    });

    await expect(
      worker.fetch(new Request("https://acme.camox.site/"), env, context(env)),
    ).rejects.toThrow("Cannot read properties of undefined");
  });
});

/** The session a signed-in member's browser holds on a project's host, in the SDK's mirror cookie. */
const MEMBER_SESSION = "__Secure-better-auth.session_token=member.c2lnbmVk";
const mirrored = (session: string) => `camox_auth_cookie=${encodeURIComponent(session)}`;

/**
 * Dispatch's bindings for Acme's website, whose Live code is its user Worker, with a draft with
 * code previewing `revision`, which only `MEMBER_SESSION` can see, as the API answers.
 */
async function previewingEnv() {
  const loader = fakeLoader();
  const builds = fakeBucket({ [ARCHIVE_KEY]: await archived(BUILD) });
  const asked: { project: string; draft: string; session: string }[] = [];
  const env = {
    ...fakeEnv({
      slugs: { acme: PROJECT },
      workers: {
        [PROJECT]: (request) => {
          const url = new URL(request.url);
          return new Response(`Live's code at ${url.pathname}${url.search}`);
        },
      },
    }),
    LOADER: loader.binding,
    REVISION_BUILDS: builds.bucket,
    CAMOX_API_URL: API_URL,
    API: {
      liveScript: async () => null,
      previewedRevision: async (question: { project: string; draft: string; session: string }) => {
        asked.push(question);
        const { project, draft, session } = question;
        return project === PROJECT && draft === DRAFT && session === MEMBER_SESSION
          ? revision
          : null;
      },
    },
  } as unknown as Env;
  const fetch = (path: string, headers: Record<string, string> = {}) =>
    worker.fetch(new Request(`https://acme.camox.site${path}`, { headers }), env, context(env));
  return { env, asked, loader, builds, fetch };
}

const PREFIX = `/_camox/r/${REVISION}/`;

describe("a draft with code's preview", () => {
  it.each([
    `/_camox/renderer?camox-draft=${DRAFT}`,
    `/_camox/data?path=%2Fpricing&camox-draft=${DRAFT}`,
    `/_camox/routes?layoutId=blog&camox-draft=${DRAFT}`,
  ])("reaches its previewed revision for a member: %s", async (path) => {
    const { fetch } = await previewingEnv();

    const response = await fetch(path, { cookie: mirrored(MEMBER_SESSION) });

    expect(await response.text()).toBe(`The revision under ${PREFIX} at ${path}`);
  });

  it("reaches it with Better Auth's own cookie too, as on the API's host", async () => {
    const { fetch } = await previewingEnv();

    const response = await fetch(`/_camox/renderer?camox-draft=${DRAFT}`, {
      cookie: `theme=dark; ${MEMBER_SESSION}`,
    });

    expect(await response.text()).toContain(`The revision under ${PREFIX}`);
  });

  it("asks the API with the request's session, about the project its host serves", async () => {
    const { fetch, asked } = await previewingEnv();

    await fetch(`/_camox/renderer?camox-draft=${DRAFT}`, { cookie: mirrored(MEMBER_SESSION) });

    expect(asked).toEqual([{ project: PROJECT, draft: DRAFT, session: MEMBER_SESSION }]);
  });

  it("sends a session that can't see the draft to the project Worker", async () => {
    const { fetch } = await previewingEnv();

    const response = await fetch(`/_camox/data?path=%2F&camox-draft=${DRAFT}`, {
      cookie: mirrored("__Secure-better-auth.session_token=outsider.c2lnbmVk"),
    });

    expect(await response.text()).toBe(`Live's code at /_camox/data?path=%2F&camox-draft=${DRAFT}`);
  });

  it("sends a visitor to the project Worker without asking the API", async () => {
    const { fetch, asked } = await previewingEnv();

    const response = await fetch(`/_camox/renderer?camox-draft=${DRAFT}`, { cookie: "theme=dark" });

    expect(await response.text()).toBe(`Live's code at /_camox/renderer?camox-draft=${DRAFT}`);
    expect(asked).toEqual([]);
  });

  it.each([
    ["a page", `/pricing?camox-draft=${DRAFT}`],
    ["the studio", `/camox?camox-draft=${DRAFT}`],
    ["another runtime route", `/og?camox-draft=${DRAFT}`],
    ["a runtime read naming no draft", "/_camox/data?path=%2F"],
  ])("sends %s to the project Worker, even for a member", async (_, path) => {
    const { fetch } = await previewingEnv();

    const response = await fetch(path, { cookie: mirrored(MEMBER_SESSION) });

    expect(await response.text()).toBe(`Live's code at ${path}`);
  });

  it("sends a member to the project Worker when the revision's build isn't stored", async () => {
    const { builds, fetch } = await previewingEnv();
    builds.objects.delete(ARCHIVE_KEY);

    const response = await fetch(`/_camox/renderer?camox-draft=${DRAFT}`, {
      cookie: mirrored(MEMBER_SESSION),
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(`Live's code at /_camox/renderer?camox-draft=${DRAFT}`);
  });

  it("sends a member to the project Worker when the API can't answer", async () => {
    const { env, fetch } = await previewingEnv();
    (env as unknown as { API: unknown }).API = {
      liveScript: async () => null,
      previewedRevision: async () => {
        throw new Error("Network connection lost.");
      },
    };

    const response = await fetch(`/_camox/renderer?camox-draft=${DRAFT}`, {
      cookie: mirrored(MEMBER_SESSION),
    });

    expect(await response.text()).toBe(`Live's code at /_camox/renderer?camox-draft=${DRAFT}`);
  });

  it("asks the API once for a burst of a member's runtime reads", async () => {
    const { fetch, asked } = await previewingEnv();
    const cookie = mirrored(MEMBER_SESSION);

    await Promise.all(
      ["/", "/pricing", "/about"].map((path) =>
        fetch(`/_camox/data?path=${encodeURIComponent(path)}&camox-draft=${DRAFT}`, { cookie }),
      ),
    );
    await fetch(`/_camox/data?path=%2Fblog&camox-draft=${DRAFT}`, { cookie });

    expect(asked).toHaveLength(1);
  });

  it("asks the API again once its answer is older than it's kept", async () => {
    const { fetch, asked } = await previewingEnv();
    const cookie = mirrored(MEMBER_SESSION);
    vi.useFakeTimers({ toFake: ["Date"] });
    onTestFinished(() => void vi.useRealTimers());

    await fetch(`/_camox/data?path=%2F&camox-draft=${DRAFT}`, { cookie });
    vi.advanceTimersByTime(PREVIEW_ANSWER_TTL_MS - 1);
    await fetch(`/_camox/data?path=%2F&camox-draft=${DRAFT}`, { cookie });
    expect(asked).toHaveLength(1);
    vi.advanceTimersByTime(2);
    await fetch(`/_camox/data?path=%2F&camox-draft=${DRAFT}`, { cookie });

    expect(asked).toHaveLength(2);
  });

  it("asks the API afresh for each renderer document, so a reload after a new revision gets it", async () => {
    const { fetch, asked } = await previewingEnv();
    const cookie = mirrored(MEMBER_SESSION);

    await fetch(`/_camox/data?path=%2F&camox-draft=${DRAFT}`, { cookie });
    await fetch(`/_camox/renderer?camox-draft=${DRAFT}`, { cookie });
    await fetch(`/_camox/data?path=%2F&camox-draft=${DRAFT}`, { cookie });

    expect(asked).toHaveLength(2);
  });
});

describe("a revision's client assets", () => {
  /** A revision dispatch has prepared, as the API asks once its build passed. */
  async function prewarmed() {
    const previewing = await previewingEnv();
    const { env } = previewing;
    await new CamoxRevisions(context(env), env).prepare(revision);
    return previewing;
  }

  it("are served under its asset prefix to anyone, once it's prepared", async () => {
    const { fetch } = await prewarmed();

    const response = await fetch(`${PREFIX}assets/pricing.css`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^text\/css/);
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(await response.text()).toBe(PRICING_CSS);
  });

  it("are served with their scripts' content type", async () => {
    const { fetch } = await prewarmed();

    const response = await fetch(`${PREFIX}assets/renderer-B1x9.js`);

    expect(response.headers.get("content-type")).toMatch(/^text\/javascript/);
  });

  it("don't include its server build", async () => {
    const { fetch } = await prewarmed();

    const response = await fetch(`${PREFIX}index.js`);

    expect(response.status).toBe(404);
  });

  it("aren't served on another project's host", async () => {
    const { env } = await prewarmed();
    const slugs: Record<string, string> = { acme: PROJECT, globex: OTHER_PROJECT };
    (env as unknown as { PROJECT_SLUGS: unknown }).PROJECT_SLUGS = {
      get: async (slug: string) => slugs[slug] ?? null,
    };

    const response = await worker.fetch(
      new Request(`https://globex.camox.site${PREFIX}assets/pricing.css`),
      env,
      context(env),
    );

    expect(response.status).toBe(404);
  });

  it("answer a revision that was never prepared with not found, not the project Worker", async () => {
    const { fetch } = await previewingEnv();

    const response = await fetch(`${PREFIX}assets/pricing.css`);

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("Live's code");
  });

  it("answer a path the build has no asset at with not found", async () => {
    const { fetch } = await prewarmed();

    const response = await fetch(`${PREFIX}assets/missing.css`);

    expect(response.status).toBe(404);
  });

  it("are stored in two objects, however many the build has", async () => {
    const { env, builds, fetch } = await previewingEnv();
    const icons = Object.fromEntries(
      Array.from({ length: 5 }, (_, at) => [`dist/client/icons/${at}.svg`, `<svg>${at}</svg>`]),
    );
    builds.objects.set(ARCHIVE_KEY, { body: await archived({ ...BUILD, ...icons }) });

    await new CamoxRevisions(context(env), env).prepare(revision);

    const stored = [...builds.objects.keys()].filter((key) =>
      key.startsWith(`${PROJECT}/revisions/${REVISION}/`),
    );
    expect(stored).toHaveLength(2);
    expect(await (await fetch(`${PREFIX}icons/3.svg`)).text()).toBe("<svg>3</svg>");
  });

  it("are still served one object each for a revision prewarmed before they were packed", async () => {
    const { builds, fetch } = await previewingEnv();
    builds.objects.set(`${PROJECT}/revisions/${REVISION}/assets/pricing.css`, {
      body: new TextEncoder().encode(PRICING_CSS),
      contentType: "text/css; charset=utf-8",
    });

    const response = await fetch(`${PREFIX}assets/pricing.css`);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(PRICING_CSS);
  });
});

describe("preparing a revision", () => {
  it("loads it and renders its renderer document once", async () => {
    const { env, loader } = await previewingEnv();

    await new CamoxRevisions(context(env), env).prepare(revision);

    expect(loader.loaded.map(({ name }) => name)).toEqual([REVISION]);
    expect(loader.fetched).toEqual([`${REVISION} /_camox/renderer`]);
  });

  it("gives the API its Definition Set, reading its build once", async () => {
    const { env, builds } = await previewingEnv();

    const prepared = await new CamoxRevisions(context(env), env).prepare(revision);

    expect(prepared.definitionSet).toEqual(definitionSet(PREFIX));
    expect(builds.gets.filter((key) => key === ARCHIVE_KEY)).toHaveLength(1);
  });

  it("fails when its build isn't stored", async () => {
    const { env } = await previewingEnv();

    await expect(
      new CamoxRevisions(context(env), env).prepare({ ...revision, archiveKey: "missing.tar.gz" }),
    ).rejects.toThrow("missing.tar.gz");
  });
});
