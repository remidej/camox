import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createProjectFixture, createSessionFixture } from "../../../test/fixtures";
import { createDb } from "../../db";
import { session } from "../../schema";
import type { Bindings } from "../../types";
import { createAuth } from "./routes";

const API = "http://localhost";

function testAuth() {
  return createAuth(createDb(env.DB), env as unknown as Bindings, API);
}

/** A project whose `<slug>.camox.site` host the KV map knows, as project creation records it. */
async function hostedProject() {
  const fixture = await createProjectFixture(crypto.randomUUID());
  await env.PROJECT_SLUGS.put(fixture.project.slug, fixture.project.uuid);
  return { ...fixture, host: `${fixture.project.slug}.camox.site` };
}

/** A project served at a Custom Domain, which the KV map records next to its slug. */
async function projectOnCustomDomain() {
  const fixture = await createProjectFixture(crypto.randomUUID());
  const domain = `${fixture.project.slug}.example`;
  await env.PROJECT_SLUGS.put(fixture.project.slug, fixture.project.uuid, {
    metadata: { customDomain: domain },
  });
  await env.PROJECT_SLUGS.put(domain, fixture.project.uuid);
  return { ...fixture, domain };
}

function request(path: string, init: { body?: unknown; headers?: Record<string, string> } = {}) {
  return testAuth().handler(
    new Request(`${API}/api/auth${path}`, {
      method: init.body === undefined ? "GET" : "POST",
      headers: {
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        ...init.headers,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
  );
}

const bearer = (sessionToken?: string): Record<string, string> =>
  sessionToken ? { authorization: `Bearer ${sessionToken}` } : {};

/** What the dashboard's /studio-authorize page asks the API for a studio callback. */
function authorizeStudio(callback: string, sessionToken?: string) {
  return request("/cross-domain/studio-authorize", {
    body: { callback },
    headers: { origin: "https://app.camox.ai", ...bearer(sessionToken) },
  });
}

/** What the dashboard's /cli-authorize and /dev-authorize pages ask the API for a local callback. */
function authorizeLocal(callback: string, sessionToken?: string) {
  return request("/cross-domain/local-authorize", {
    body: { callback },
    headers: { origin: "https://app.camox.ai", ...bearer(sessionToken) },
  });
}

/** Exchanges a one-time token for a session, as the SDK's auth client does. */
function exchange(ott: string) {
  return request("/one-time-token/verify", {
    body: { token: ott },
    headers: {
      origin: "https://acme.camox.site",
      "better-auth-cookie": "",
      "user-agent": "Studio Browser/1.0",
      "x-forwarded-for": "203.0.113.7",
    },
  });
}

async function redirectTo(response: Response) {
  expect(response.status).toBe(200);
  const { url } = (await response.json()) as { url: string };
  return new URL(url);
}

/** The session that the one-time token in an authorization's URL exchanges for. */
async function exchanged(authorization: Response) {
  const response = await exchange((await redirectTo(authorization)).searchParams.get("ott")!);
  expect(response.status).toBe(200);
  return (await response.json()) as { session: { token: string }; user: { id: string } };
}

async function signedInUser(sessionToken: string) {
  const response = await request("/get-session", {
    headers: { ...bearer(sessionToken), origin: "https://app.camox.ai" },
  });
  const body = (await response.json()) as { user: { id: string } } | null;
  return body?.user.id ?? null;
}

describe("authorizing the studio on a host", () => {
  it("sends a member straight back to their project's host with a one-time token", async () => {
    const { memberUser, host } = await hostedProject();
    const callback = `https://${host}/pricing?camox=1`;

    const url = await redirectTo(
      await authorizeStudio(callback, await createSessionFixture(memberUser.id)),
    );

    expect(url.origin).toBe(`https://${host}`);
    expect(url.pathname).toBe("/pricing");
    expect(url.searchParams.get("camox")).toBe("1");
    expect(url.searchParams.get("ott")).toBeTruthy();
  });

  it("accepts localhost", async () => {
    const { memberUser } = await hostedProject();

    const url = await redirectTo(
      await authorizeStudio("http://localhost:3000/", await createSessionFixture(memberUser.id)),
    );

    expect(url.origin).toBe("http://localhost:3000");
    expect(url.searchParams.get("ott")).toBeTruthy();
  });

  it("refuses a project's host to a user who isn't a member of it", async () => {
    const { outsiderUser, host } = await hostedProject();

    const response = await authorizeStudio(
      `https://${host}/`,
      await createSessionFixture(outsiderUser.id),
    );

    expect(response.status).toBe(403);
  });

  it("refuses another project's host", async () => {
    const mine = await hostedProject();
    const theirs = await hostedProject();

    const response = await authorizeStudio(
      `https://${theirs.host}/`,
      await createSessionFixture(mine.memberUser.id),
    );

    expect(response.status).toBe(403);
  });

  it.each([
    ["a slug the map doesn't know", "https://unknown-slug.camox.site/"],
    ["a site off camox.site", "https://evil.example/"],
    ["a host that only starts like a project's", "https://{slug}.camox.site.evil.example/"],
    ["a deeper subdomain of a project's host", "https://www.{slug}.camox.site/"],
    ["a project's host with credentials", "https://user:secret@{slug}.camox.site/"],
    ["a project's host over plain http", "http://{slug}.camox.site/"],
    ["a project's host on another port", "https://{slug}.camox.site:8443/"],
  ])("refuses %s", async (_, callback) => {
    const { memberUser, project } = await hostedProject();

    const response = await authorizeStudio(
      callback.replace("{slug}", project.slug),
      await createSessionFixture(memberUser.id),
    );

    expect(response.status).toBe(403);
  });

  it("sends a member back to their project's Custom Domain with a one-time token", async () => {
    const { memberUser, domain } = await projectOnCustomDomain();

    const url = await redirectTo(
      await authorizeStudio(
        `https://${domain}/pricing?camox=1`,
        await createSessionFixture(memberUser.id),
      ),
    );

    expect(url.origin).toBe(`https://${domain}`);
    expect(url.pathname).toBe("/pricing");
    expect(url.searchParams.get("ott")).toBeTruthy();
  });

  it("refuses a project's Custom Domain to a user who isn't a member of it", async () => {
    const { outsiderUser, domain } = await projectOnCustomDomain();

    const response = await authorizeStudio(
      `https://${domain}/`,
      await createSessionFixture(outsiderUser.id),
    );

    expect(response.status).toBe(403);
  });

  it.each([
    ["a subdomain of a project's Custom Domain", "https://www.{domain}/"],
    ["a project's Custom Domain over plain http", "http://{domain}/"],
    ["a project's Custom Domain on another port", "https://{domain}:8443/"],
    ["a Custom Domain's entry under camox.site", "https://{domain}.camox.site/"],
    ["the camox.site host it redirects to its Custom Domain", "https://{slug}.camox.site/"],
  ])("refuses %s", async (_, callback) => {
    const { memberUser, domain, project } = await projectOnCustomDomain();

    const response = await authorizeStudio(
      callback.replace("{domain}", domain).replace("{slug}", project.slug),
      await createSessionFixture(memberUser.id),
    );

    expect(response.status).toBe(403);
  });

  it("refuses a signed-out user", async () => {
    const { host } = await hostedProject();

    const response = await authorizeStudio(`https://${host}/`);

    expect(response.status).toBe(401);
  });
});

describe("authorizing a local callback", () => {
  it.each([
    ["the CLI's callback server", "http://localhost:43123/callback"],
    ["a dev server on 127.0.0.1", "http://127.0.0.1:5173/__camox/auth/callback?state=abc"],
    ["a dev server on a worktree hostname", "http://camox-wt.localhost:5173/__camox/auth/callback"],
    ["a dev server on IPv6 loopback", "http://[::1]:5173/__camox/auth/callback"],
  ])("hands a one-time token to %s", async (_, callback) => {
    const { memberUser } = await hostedProject();

    const url = await redirectTo(
      await authorizeLocal(callback, await createSessionFixture(memberUser.id)),
    );

    expect(url.origin).toBe(new URL(callback).origin);
    expect(url.pathname).toBe(new URL(callback).pathname);
    expect(url.searchParams.get("ott")).toBeTruthy();
  });

  it.each([
    ["a site off this computer", "https://evil.example/callback"],
    ["a host that only starts like localhost", "http://localhost.evil.example/callback"],
    ["the member's own project host", "https://{slug}.camox.site/"],
    ["localhost with credentials", "http://user:secret@localhost:43123/callback"],
    ["a non-web scheme", "javascript://localhost/%0aalert(1)"],
  ])("refuses %s", async (_, callback) => {
    const { memberUser, project } = await hostedProject();

    const response = await authorizeLocal(
      callback.replace("{slug}", project.slug),
      await createSessionFixture(memberUser.id),
    );

    expect(response.status).toBe(403);
  });

  it("refuses a signed-out user", async () => {
    const response = await authorizeLocal("http://localhost:43123/callback");

    expect(response.status).toBe(401);
  });

  it("gives the CLI a session that can create preview sign-in links", async () => {
    const { memberUser } = await hostedProject();
    const cli = await exchanged(
      await authorizeLocal(
        "http://localhost:43123/callback",
        await createSessionFixture(memberUser.id),
      ),
    );

    // The CLI calls from Node: a bearer token and no Origin.
    const preview = await request("/cross-domain/studio-authorize", {
      body: { callback: "http://localhost:5173/" },
      headers: bearer(cli.session.token),
    });

    expect((await redirectTo(preview)).searchParams.get("ott")).toBeTruthy();
  });
});

describe("one-time tokens for any callback", () => {
  it("can't be generated without naming a callback the API checks", async () => {
    const { memberUser } = await hostedProject();

    const response = await request("/one-time-token/generate", {
      headers: bearer(await createSessionFixture(memberUser.id)),
    });

    expect(response.status).toBe(404);
  });
});

describe("exchanging the one-time token", () => {
  it("gives the studio its own session, which signs out without signing out the dashboard", async () => {
    const { memberUser, host } = await hostedProject();
    const dashboard = await createSessionFixture(memberUser.id);

    const studio = await exchanged(await authorizeStudio(`https://${host}/`, dashboard));

    expect(studio.user.id).toBe(memberUser.id);
    expect(studio.session.token).not.toBe(dashboard);
    expect(await signedInUser(studio.session.token)).toBe(memberUser.id);

    const signOut = await request("/sign-out", {
      body: {},
      headers: { ...bearer(studio.session.token), origin: `https://${host}` },
    });
    expect(signOut.status).toBe(200);

    expect(await signedInUser(studio.session.token)).toBeNull();
    expect(await signedInUser(dashboard)).toBe(memberUser.id);
  });

  it("records where the session was signed in from, like any other sign-in", async () => {
    const { memberUser, host } = await hostedProject();

    const studio = await exchanged(
      await authorizeStudio(`https://${host}/`, await createSessionFixture(memberUser.id)),
    );

    const stored = await createDb(env.DB)
      .select({ ipAddress: session.ipAddress, userAgent: session.userAgent })
      .from(session)
      .where(eq(session.token, studio.session.token))
      .get();
    expect(stored).toEqual({ ipAddress: "203.0.113.7", userAgent: "Studio Browser/1.0" });
  });

  it("can't be exchanged twice", async () => {
    const { memberUser, host } = await hostedProject();
    const url = await redirectTo(
      await authorizeStudio(`https://${host}/`, await createSessionFixture(memberUser.id)),
    );
    const ott = url.searchParams.get("ott")!;
    expect((await exchange(ott)).status).toBe(200);

    expect((await exchange(ott)).status).toBe(400);
  });

  it("hands a studio on localhost its session for the SDK to keep, never as the API's own cookie", async () => {
    const { memberUser } = await hostedProject();
    const url = await redirectTo(
      await authorizeStudio("http://localhost:3000/", await createSessionFixture(memberUser.id)),
    );

    const response = await exchange(url.searchParams.get("ott")!);

    // The SDK mirrors it into `camox_auth_cookie`, the only session the site's SSR reads: a
    // cookie set for localhost would reach every local port, the dashboard's session among them.
    expect(response.headers.get("set-better-auth-cookie")).toMatch(/session_token=/);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});

describe("a studio session, which the site's scripts can read", () => {
  async function studioSession() {
    const { memberUser, host } = await hostedProject();
    const dashboard = await createSessionFixture(memberUser.id);
    const studio = await exchanged(await authorizeStudio(`https://${host}/`, dashboard));
    return { host, dashboard, studio: studio.session.token };
  }

  it("can't sign the studio in anywhere else", async () => {
    const { host, studio } = await studioSession();

    expect((await authorizeStudio(`https://${host}/`, studio)).status).toBe(403);
    expect((await authorizeStudio("http://localhost:3000/", studio)).status).toBe(403);
  });

  it("can't hand a session to a local callback", async () => {
    const { studio } = await studioSession();

    const response = await authorizeLocal("http://localhost:43123/callback", studio);

    expect(response.status).toBe(403);
  });

  it("can't read the tokens of the user's other sessions", async () => {
    const { host, dashboard, studio } = await studioSession();

    const response = await request("/list-sessions", {
      headers: { ...bearer(studio), origin: `https://${host}` },
    });

    // Refused as a studio session, not merely as an unknown one.
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain(dashboard);
  });

  it("is a studio session even when signed in on localhost", async () => {
    const { memberUser } = await hostedProject();
    const preview = await exchanged(
      await authorizeStudio("http://localhost:5173/", await createSessionFixture(memberUser.id)),
    );

    const response = await authorizeLocal("http://localhost:43123/callback", preview.session.token);

    expect(response.status).toBe(403);
  });
});

describe("signing in with GitHub", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** GitHub, as the OAuth callback talks to it, for a user signing in as `email`. */
  function fakeGitHub(email: string) {
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith("https://github.com/login/oauth/access_token")) {
        return json({ access_token: "github-token", token_type: "bearer", scope: "user:email" });
      }
      if (url === "https://api.github.com/user") {
        return json({ id: 4242, login: "octo", name: "Octo", email, avatar_url: "" });
      }
      if (url === "https://api.github.com/user/emails") {
        return json([{ email, primary: true, verified: true }]);
      }
      throw new Error(`Unexpected fetch to ${url}`);
    });
  }

  it("doesn't hand a one-time token to the site it returns to", async () => {
    const start = await request("/sign-in/social", {
      body: { provider: "github", callbackURL: "https://evil.example/landing" },
      headers: { origin: "https://evil.example" },
    });
    expect(start.status).toBe(200);
    const { url } = (await start.json()) as { url: string };
    const state = new URL(url).searchParams.get("state")!;
    fakeGitHub(`octo-${crypto.randomUUID()}@example.com`);

    const callback = await request(`/callback/github?code=github-code&state=${state}`);

    expect(callback.status).toBe(302);
    const location = new URL(callback.headers.get("location")!);
    expect(location.origin).toBe("https://evil.example");
    expect(location.searchParams.has("ott")).toBe(false);
  });
});
