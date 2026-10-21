import { describe, expect, it } from "vite-plus/test";

import worker, { type Env } from "./worker";

type UserWorker = (request: Request) => Response | Promise<Response>;

/** The bindings as Cloudflare gives them, backed by a plain slug map and the user Workers deployed so far. */
function fakeEnv({
  slugs = {},
  workers = {},
}: {
  slugs?: Record<string, string>;
  workers?: Record<string, UserWorker>;
}) {
  const env = {
    SITE_SLUGS: {
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

describe("dispatch Worker", () => {
  it("serves a project's website from the user Worker named after its UUID", async () => {
    const env = fakeEnv({
      slugs: { acme: ACME_UUID },
      workers: {
        [ACME_UUID]: (request) => new Response(`acme site at ${new URL(request.url).pathname}`),
        "0b8e6a4f-0000-4000-8000-000000000000": () => new Response("another site"),
      },
    });

    const response = await worker.fetch(new Request("https://acme.camox.site/pricing"), env);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("acme site at /pricing");
  });

  it("answers an unknown slug with a not-found page", async () => {
    const env = fakeEnv({
      slugs: { acme: ACME_UUID },
      workers: { [ACME_UUID]: () => new Response("acme site") },
    });

    const response = await worker.fetch(new Request("https://globex.camox.site/"), env);

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toMatch(/^text\/html/);
    expect(await response.text()).toContain("not found");
  });

  // Universal SSL only covers first-level subdomains, so a site is exactly one label under camox.site.
  it.each([
    ["a deeper subdomain", "https://www.acme.camox.site/"],
    ["the bare domain", "https://camox.site/"],
    ["another domain", "https://acme.example.com/"],
  ])("answers %s with a not-found page, even when a label matches a slug", async (_, url) => {
    const env = fakeEnv({
      slugs: { acme: ACME_UUID, www: ACME_UUID, camox: ACME_UUID },
      workers: { [ACME_UUID]: () => new Response("acme site") },
    });

    const response = await worker.fetch(new Request(url), env);

    expect(response.status).toBe(404);
  });

  it("tells visitors a project's website is being set up until its user Worker is deployed", async () => {
    const env = fakeEnv({ slugs: { acme: ACME_UUID } });

    const response = await worker.fetch(new Request("https://acme.camox.site/"), env);

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

    const response = await worker.fetch(new Request("https://acme.camox.site/"), env);

    expect(await response.text()).toContain("This site is being set up");
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

    await expect(worker.fetch(new Request("https://acme.camox.site/"), env)).rejects.toThrow(
      "Cannot read properties of undefined",
    );
  });
});
