import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  API_URL,
  ARCHIVE_KEY,
  archived,
  BUILD,
  context,
  DRAFT,
  definitionSet,
  fakeBucket,
  fakeLoader,
  REVISION,
  revision,
} from "../test/fakes";
import { CamoxRevisions, type Env } from "./worker";

/** Dispatch's bindings, with its R2 bucket of revision builds holding `archives` by key. */
function fakeEnv(archives: Record<string, Uint8Array>) {
  const loader = fakeLoader();
  const env = {
    LOADER: loader.binding,
    CAMOX_API_URL: API_URL,
    REVISION_BUILDS: fakeBucket(archives).bucket,
  } as unknown as Env;
  return { env, loaded: loader.loaded };
}

async function readDefinitionSet(env: Env) {
  return new CamoxRevisions(context(env), env).readDefinitionSet(revision);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a revision, as dispatch loads it", () => {
  it("gives the API its Definition Set, read from its build under its asset prefix", async () => {
    const { env } = fakeEnv({ [ARCHIVE_KEY]: await archived(BUILD) });

    expect(await readDefinitionSet(env)).toEqual(definitionSet(`/_camox/r/${REVISION}/`));
  });

  it("runs with the compatibility date and flags of its build's Wrangler configuration", async () => {
    const { env, loaded } = fakeEnv({ [ARCHIVE_KEY]: await archived(BUILD) });

    await readDefinitionSet(env);

    expect(loaded).toMatchObject([
      {
        name: REVISION,
        code: { compatibilityDate: "2026-04-11", compatibilityFlags: ["nodejs_compat"] },
      },
    ]);
  });

  it("is loaded once however often it's read", async () => {
    const { env, loaded } = fakeEnv({ [ARCHIVE_KEY]: await archived(BUILD) });

    await readDefinitionSet(env);
    await readDefinitionSet(env);

    expect(loaded).toHaveLength(1);
  });

  it("fails to load when its build isn't stored", async () => {
    const { env } = fakeEnv({});

    await expect(readDefinitionSet(env)).rejects.toThrow(ARCHIVE_KEY);
  });
});

describe("a revision's outbound requests, through its gateway", () => {
  /** The gateway the loaded revision sends its outbound requests to. */
  async function gatewayOf() {
    const { env, loaded } = fakeEnv({ [ARCHIVE_KEY]: await archived(BUILD) });
    await readDefinitionSet(env);
    return loaded[0]!.code.globalOutbound!;
  }

  /** The internet, which records each request reaching it. */
  function internet() {
    const reached: Request[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo, init?: RequestInit) => {
      reached.push(new Request(input, init));
      return new Response("reached");
    });
    return reached;
  }

  it("reach the Camox API in the revision's draft, whichever draft they name", async () => {
    const gateway = await gatewayOf();
    const reached = internet();

    const response = await gateway.fetch(
      new Request(`${API_URL}/rpc/pages/list`, {
        method: "POST",
        headers: { "x-camox-draft": "another-draft", cookie: "camox_auth=session" },
        body: "{}",
      }),
    );

    expect(await response.text()).toBe("reached");
    expect(reached).toHaveLength(1);
    expect(reached[0]!.url).toBe(`${API_URL}/rpc/pages/list`);
    expect(reached[0]!.headers.get("x-camox-draft")).toBe(DRAFT);
    expect(reached[0]!.headers.get("cookie")).toBe("camox_auth=session");
    expect(await reached[0]!.text()).toBe("{}");
  });

  it("reach the Camox API with the look token the revision read the draft's content with", async () => {
    // ADR 0032: a look document's reads of the draft carry the browser's look token, not a session.
    const gateway = await gatewayOf();
    const reached = internet();

    await gateway.fetch(
      new Request(`${API_URL}/rpc/pages/getStructure`, {
        method: "POST",
        headers: { "x-camox-draft": DRAFT, "x-camox-look-token": "look.c2lnbmVk" },
        body: "{}",
      }),
    );

    expect(reached).toHaveLength(1);
    expect(reached[0]!.headers.get("x-camox-look-token")).toBe("look.c2lnbmVk");
    expect(reached[0]!.headers.get("x-camox-draft")).toBe(DRAFT);
  });

  it("reach any other host as they were sent", async () => {
    const gateway = await gatewayOf();
    const reached = internet();

    await gateway.fetch(
      new Request("https://weather.example.com/today", {
        headers: { "x-camox-draft": "another-draft" },
      }),
    );

    expect(reached.map((request) => request.url)).toEqual(["https://weather.example.com/today"]);
    expect(reached[0]!.headers.get("x-camox-draft")).toBe("another-draft");
  });
});
