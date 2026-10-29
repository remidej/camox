import { describe, expect, it, onTestFinished, vi } from "vite-plus/test";

import {
  API_URL,
  ARCHIVE_KEY,
  archived,
  archivedSdkBundle,
  BROWSER_SDK_BUNDLE,
  BUILD,
  BUNDLED_BUILD,
  context,
  DRAFT,
  fakeBucket,
  fakeLoader,
  definitionSet,
  PRICING_CSS,
  PROJECT,
  REVISION,
  revision,
  SDK_BUNDLE,
  SDK_BUNDLE_ARCHIVE_KEYS,
  STUDIO_CSS,
  WORKERD_SDK_BUNDLE,
} from "../test/fakes";
import { LIVE_SCRIPT_TTL_MS } from "./live-script";
import { PREVIEW_ANSWER_TTL_MS } from "./previews";
import worker, { CamoxRevisions, type Env } from "./worker";

const OTHER_PROJECT = "0b8e6a4f-0000-4000-8000-000000000000";

type UserWorker = (request: Request) => Response | Promise<Response>;

/**
 * The `camox-project-slugs` KV namespace holding `slugs` and `customDomains`, written as the
 * operator doc in README.md says: each Custom Domain maps to its Project ID, and its project's
 * slug entry names it in its metadata.
 */
function fakeProjectHosts(
  slugs: Record<string, string>,
  customDomains: Record<string, string> = {},
) {
  const entries = new Map<string, { value: string; metadata: unknown }>();
  for (const [slug, uuid] of Object.entries(slugs)) {
    const customDomain = Object.keys(customDomains).find(
      (domain) => customDomains[domain] === uuid,
    );
    entries.set(slug, { value: uuid, metadata: customDomain ? { customDomain } : null });
  }
  for (const [domain, uuid] of Object.entries(customDomains)) {
    entries.set(domain, { value: uuid, metadata: null });
  }
  return {
    get: async (key: string) => entries.get(key)?.value ?? null,
    getWithMetadata: async (key: string) =>
      entries.get(key) ?? { value: null, metadata: null, cacheStatus: null },
  } as unknown as KVNamespace;
}

/**
 * The bindings as Cloudflare gives them, backed by a plain slug map and Custom Domain map, the
 * user Workers deployed so far, and the API naming the publish's Worker that serves a project, if
 * any (`liveScripts`).
 */
function fakeEnv({
  slugs = {},
  customDomains = {},
  workers = {},
  liveScripts = {},
}: {
  slugs?: Record<string, string>;
  customDomains?: Record<string, string>;
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
    PROJECT_SLUGS: fakeProjectHosts(slugs, customDomains),
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

  it("serves a project's website at its Custom Domain", async () => {
    const env = fakeEnv({
      slugs: { acme: ACME_UUID, globex: OTHER_PROJECT },
      customDomains: { "acme.example": ACME_UUID },
      workers: {
        [ACME_UUID]: (request) => new Response(`acme website at ${new URL(request.url).pathname}`),
        [OTHER_PROJECT]: () => new Response("another website"),
      },
    });

    const response = await worker.fetch(
      new Request("https://acme.example/pricing"),
      env,
      context(env),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("acme website at /pricing");
  });

  it("redirects a project's camox.site address to its Custom Domain, path and query kept", async () => {
    const env = fakeEnv({
      slugs: { acme: ACME_UUID },
      customDomains: { "acme.example": ACME_UUID },
      workers: { [ACME_UUID]: () => new Response("acme website") },
    });

    const response = await worker.fetch(
      new Request("https://acme.camox.site/blog/hello?ref=newsletter&page=2"),
      env,
      context(env),
    );

    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe(
      "https://acme.example/blog/hello?ref=newsletter&page=2",
    );
  });

  it.each([
    ["a subdomain of a Custom Domain", "https://www.acme.example/"],
    ["a Custom Domain under camox.site", "https://acme.example.camox.site/"],
  ])("answers %s with a not-found page", async (_, url) => {
    const env = fakeEnv({
      slugs: { acme: ACME_UUID },
      customDomains: { "acme.example": ACME_UUID },
      workers: { [ACME_UUID]: () => new Response("acme website") },
    });

    const response = await worker.fetch(new Request(url), env, context(env));

    expect(response.status).toBe(404);
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
async function previewingEnv({
  customDomain,
  build = BUILD,
}: { customDomain?: string; build?: Record<string, string> } = {}) {
  const loader = fakeLoader();
  const builds = fakeBucket({
    [ARCHIVE_KEY]: await archived(build),
    [SDK_BUNDLE_ARCHIVE_KEYS.browser]: await archivedSdkBundle(BROWSER_SDK_BUNDLE),
    [SDK_BUNDLE_ARCHIVE_KEYS.workerd]: await archivedSdkBundle(WORKERD_SDK_BUNDLE),
  });
  const asked: { project: string; draft: string; session: string }[] = [];
  const env = {
    ...fakeEnv({
      slugs: { acme: PROJECT },
      customDomains: customDomain ? { [customDomain]: PROJECT } : {},
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
    worker.fetch(
      new Request(`https://${customDomain ?? "acme.camox.site"}${path}`, { headers }),
      env,
      context(env),
    );
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

  it("reaches its previewed revision for a member on the project's Custom Domain", async () => {
    const { fetch, asked } = await previewingEnv({ customDomain: "acme.example" });
    const path = `/_camox/data?path=%2Fpricing&camox-draft=${DRAFT}`;

    const response = await fetch(path, { cookie: mirrored(MEMBER_SESSION) });

    expect(await response.text()).toBe(`The revision under ${PREFIX} at ${path}`);
    expect(asked).toEqual([{ project: PROJECT, draft: DRAFT, session: MEMBER_SESSION }]);
  });

  it.each([
    ["the project's camox.site host", undefined],
    ["the project's Custom Domain", "acme.example"],
  ])(
    "treats a request with only a native session cookie as signed out on %s",
    async (_, customDomain) => {
      // On camox.ai, Better Auth's own cookie is the dashboard's session, set for every host.
      const { fetch, asked } = await previewingEnv({ customDomain });

      const response = await fetch(`/_camox/renderer?camox-draft=${DRAFT}`, {
        cookie: `theme=dark; ${MEMBER_SESSION}`,
      });

      expect(await response.text()).toBe(`Live's code at /_camox/renderer?camox-draft=${DRAFT}`);
      expect(asked).toEqual([]);
    },
  );

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

  it("are served on the project's Custom Domain", async () => {
    const previewing = await previewingEnv({ customDomain: "acme.example" });
    await new CamoxRevisions(context(previewing.env), previewing.env).prepare(revision);

    const response = await previewing.fetch(`${PREFIX}assets/pricing.css`);

    expect(response.status).toBe(200);
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
    (env as unknown as { PROJECT_SLUGS: unknown }).PROJECT_SLUGS = fakeProjectHosts(slugs);

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

  it("prepares it from the build the API sends, without reading it back", async () => {
    const { env, builds, fetch } = await previewingEnv();
    builds.objects.delete(ARCHIVE_KEY);

    const prepared = await new CamoxRevisions(context(env), env).prepare(
      revision,
      await archived(BUILD),
    );

    expect(prepared.definitionSet).toEqual(definitionSet(PREFIX));
    expect(builds.gets).not.toContain(ARCHIVE_KEY);
    expect(await (await fetch(`${PREFIX}assets/pricing.css`)).text()).toBe(PRICING_CSS);
  });

  it("fails when its build isn't stored", async () => {
    const { env } = await previewingEnv();

    await expect(
      new CamoxRevisions(context(env), env).prepare({ ...revision, archiveKey: "missing.tar.gz" }),
    ).rejects.toThrow("missing.tar.gz");
  });
});

describe("a revision built against an SDK Bundle", () => {
  /** A bundled revision dispatch has prepared, as the API asks once its build passed. */
  async function prepared() {
    const previewing = await previewingEnv({ build: BUNDLED_BUILD });
    const { env } = previewing;
    await new CamoxRevisions(context(env), env).prepare(revision);
    return previewing;
  }

  it("runs with its SDK Bundle's workerd modules beside its build's", async () => {
    const { fetch } = await prepared();

    const response = await fetch(`/_camox/renderer?camox-draft=${DRAFT}`, {
      cookie: mirrored(MEMBER_SESSION),
    });

    expect(await response.text()).toBe(
      `rendered by the SDK Bundle: the revision under ${PREFIX} at /_camox/renderer?camox-draft=${DRAFT}`,
    );
  });

  it("reads its SDK Bundle's modules once for every revision naming it", async () => {
    const { env, builds } = await previewingEnv({ build: BUNDLED_BUILD });
    const other = { ...revision, revision: "0195f2a4-9b8c-7d6e-8f00-778899aabbcc" };
    builds.objects.set(other.archiveKey, builds.objects.get(ARCHIVE_KEY)!);

    await new CamoxRevisions(context(env), env).prepare(revision);
    await new CamoxRevisions(context(env), env).prepare(other);

    expect(builds.gets.filter((key) => key === SDK_BUNDLE_ARCHIVE_KEYS.workerd)).toHaveLength(1);
  });

  it("never replaces a stored SDK Bundle's files when revisions naming it are prepared at once", async () => {
    const { env, builds } = await previewingEnv({ build: BUNDLED_BUILD });
    const other = { ...revision, revision: "0195f2a4-9b8c-7d6e-8f00-778899aabbcc" };
    builds.objects.set(other.archiveKey, builds.objects.get(ARCHIVE_KEY)!);

    await Promise.all(
      [revision, other].map((toPrepare) =>
        new CamoxRevisions(context(env), env).prepare(toPrepare),
      ),
    );

    expect(builds.replaced.filter((key) => key.startsWith("sdk/"))).toEqual([]);
  });

  it("serves its SDK Bundle's browser files to anyone, for good", async () => {
    const { fetch } = await prepared();

    const response = await fetch(`/_camox/sdk/${SDK_BUNDLE.browser}/camox-studio-Q2x8.css`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^text\/css/);
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(await response.text()).toBe(STUDIO_CSS);
  });

  it("serves its SDK Bundle's browser files on another project's host too", async () => {
    const { env } = await prepared();
    const slugs: Record<string, string> = { acme: PROJECT, globex: OTHER_PROJECT };
    (env as unknown as { PROJECT_SLUGS: unknown }).PROJECT_SLUGS = fakeProjectHosts(slugs);

    const response = await worker.fetch(
      new Request(`https://globex.camox.site/_camox/sdk/${SDK_BUNDLE.browser}/entry.mjs`),
      env,
      context(env),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^text\/javascript/);
  });

  it("doesn't serve its SDK Bundle's workerd half", async () => {
    const { fetch } = await prepared();

    const response = await fetch(`/_camox/sdk/${SDK_BUNDLE.workerd}/entry.mjs`);

    // Live's Worker answers, which holds no workerd modules among its assets.
    expect(await response.text()).toBe(
      `Live's code at /_camox/sdk/${SDK_BUNDLE.workerd}/entry.mjs`,
    );
  });

  it("answers a path its SDK Bundle has no file at with not found", async () => {
    const { fetch } = await prepared();

    const response = await fetch(`/_camox/sdk/${SDK_BUNDLE.browser}/missing.mjs`);

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("Live's code");
  });
});

describe("a whole-app revision", () => {
  it("is prepared and runs without reading any SDK Bundle", async () => {
    const { env, builds, fetch } = await previewingEnv();

    await new CamoxRevisions(context(env), env).prepare(revision);
    const response = await fetch(`/_camox/renderer?camox-draft=${DRAFT}`, {
      cookie: mirrored(MEMBER_SESSION),
    });

    expect(await response.text()).toBe(
      `The revision under ${PREFIX} at /_camox/renderer?camox-draft=${DRAFT}`,
    );
    expect(builds.gets.filter((key) => key.startsWith("sdk/"))).toEqual([]);
  });
});

describe("Live built against an SDK Bundle", () => {
  it("serves an SDK Bundle's files from Live's Worker when no revision naming it was prepared", async () => {
    // As after an Upgrade's release: Live's Worker holds the bundle as its static assets.
    const { fetch } = await previewingEnv({ build: BUNDLED_BUILD });

    const response = await fetch(`/_camox/sdk/${SDK_BUNDLE.browser}/entry.mjs`, {
      cookie: mirrored(MEMBER_SESSION),
    });

    expect(await response.text()).toBe(
      `Live's code at /_camox/sdk/${SDK_BUNDLE.browser}/entry.mjs`,
    );
  });
});

describe("the look document", () => {
  // ADR 0032: the browser the agent's `look` tool drives carries a look token, not a session.
  const LOOK = `/_camox/look?camox-draft=${DRAFT}&path=%2Fpricing`;

  it("reaches Live's code with the request's look token, for a draft without code changes", async () => {
    const asked: unknown[] = [];
    const env = {
      ...fakeEnv({
        slugs: { acme: ACME_UUID },
        workers: {
          [ACME_UUID]: (request) => {
            const url = new URL(request.url);
            return new Response(
              `Live's code at ${url.pathname}${url.search} with ${request.headers.get("cookie")}`,
            );
          },
        },
      }),
      API: {
        liveScript: async () => null,
        previewedRevision: async (question: unknown) => {
          asked.push(question);
          return null;
        },
      },
    } as unknown as Env;

    const response = await worker.fetch(
      new Request(`https://acme.camox.site${LOOK}`, { headers: { cookie: "camox_look=token" } }),
      env,
      context(env),
    );

    expect(await response.text()).toBe(`Live's code at ${LOOK} with camox_look=token`);
    // A look token isn't a member's session: nothing asks which revision it may see.
    expect(asked).toEqual([]);
  });
});
