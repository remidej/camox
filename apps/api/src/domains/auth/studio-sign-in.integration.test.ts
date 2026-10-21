import { env } from "cloudflare:workers";
import { describe, expect, it } from "vite-plus/test";

import { createProjectFixture } from "../../../test/fixtures";
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

/** Signs a user into the dashboard, returning the session's token. */
async function dashboardSession(userId: string) {
  const token = `dashboard-${crypto.randomUUID()}`;
  const now = new Date();
  await createDb(env.DB)
    .insert(session)
    .values({
      id: `session-${crypto.randomUUID()}`,
      token,
      userId,
      expiresAt: new Date(now.getTime() + 60 * 60_000),
      createdAt: now,
      updatedAt: now,
    });
  return token;
}

/** What the dashboard's /studio-authorize page asks the API for a studio callback. */
function authorizeStudio(callback: string, sessionToken?: string) {
  return testAuth().handler(
    new Request(`${API}/api/auth/cross-domain/studio-authorize`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://app.camox.dev",
        ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {}),
      },
      body: JSON.stringify({ callback }),
    }),
  );
}

/** The session the studio gets by exchanging the one-time token, as the SDK's auth client does. */
async function exchange(ott: string) {
  const response = await testAuth().handler(
    new Request(`${API}/api/auth/one-time-token/verify`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://acme.camox.site",
        "better-auth-cookie": "",
      },
      body: JSON.stringify({ token: ott }),
    }),
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as { session: { token: string }; user: { id: string } };
  return body;
}

async function signedInUser(sessionToken: string) {
  const response = await testAuth().handler(
    new Request(`${API}/api/auth/get-session`, {
      headers: { authorization: `Bearer ${sessionToken}`, origin: "https://app.camox.dev" },
    }),
  );
  const body = (await response.json()) as { user: { id: string } } | null;
  return body?.user.id ?? null;
}

async function redirectTo(response: Response) {
  expect(response.status).toBe(200);
  const { url } = (await response.json()) as { url: string };
  return new URL(url);
}

describe("authorizing the studio on a host", () => {
  it("sends a member straight back to their project's host with a one-time token", async () => {
    const { memberUser, host } = await hostedProject();
    const callback = `https://${host}/pricing?camox=1`;

    const url = await redirectTo(
      await authorizeStudio(callback, await dashboardSession(memberUser.id)),
    );

    expect(url.origin).toBe(`https://${host}`);
    expect(url.pathname).toBe("/pricing");
    expect(url.searchParams.get("camox")).toBe("1");
    expect(url.searchParams.get("ott")).toBeTruthy();
  });

  it("accepts localhost", async () => {
    const { memberUser } = await hostedProject();

    const url = await redirectTo(
      await authorizeStudio("http://localhost:3000/", await dashboardSession(memberUser.id)),
    );

    expect(url.origin).toBe("http://localhost:3000");
    expect(url.searchParams.get("ott")).toBeTruthy();
  });

  it("refuses a project's host to a user who isn't a member of it", async () => {
    const { outsiderUser, host } = await hostedProject();

    const response = await authorizeStudio(
      `https://${host}/`,
      await dashboardSession(outsiderUser.id),
    );

    expect(response.status).toBe(403);
  });

  it("refuses another project's host", async () => {
    const mine = await hostedProject();
    const theirs = await hostedProject();

    const response = await authorizeStudio(
      `https://${theirs.host}/`,
      await dashboardSession(mine.memberUser.id),
    );

    expect(response.status).toBe(403);
  });

  it.each([
    ["a slug the map doesn't know", "https://unknown-slug.camox.site/"],
    ["a site off camox.site", "https://evil.example/"],
    ["a host that only starts like a project's", "https://{slug}.camox.site.evil.example/"],
    ["a deeper subdomain of a project's host", "https://www.{slug}.camox.site/"],
  ])("refuses %s", async (_, callback) => {
    const { memberUser, project } = await hostedProject();

    const response = await authorizeStudio(
      callback.replace("{slug}", project.slug),
      await dashboardSession(memberUser.id),
    );

    expect(response.status).toBe(403);
  });

  it("refuses a signed-out user", async () => {
    const { host } = await hostedProject();

    const response = await authorizeStudio(`https://${host}/`);

    expect(response.status).toBe(401);
  });
});

describe("exchanging the one-time token", () => {
  it("gives the studio its own session, which signs out without signing out the dashboard", async () => {
    const { memberUser, host } = await hostedProject();
    const dashboard = await dashboardSession(memberUser.id);
    const url = await redirectTo(await authorizeStudio(`https://${host}/`, dashboard));

    const studio = await exchange(url.searchParams.get("ott")!);

    expect(studio.user.id).toBe(memberUser.id);
    expect(studio.session.token).not.toBe(dashboard);
    expect(await signedInUser(studio.session.token)).toBe(memberUser.id);

    const signOut = await testAuth().handler(
      new Request(`${API}/api/auth/sign-out`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${studio.session.token}`,
          origin: `https://${host}`,
          "content-type": "application/json",
        },
        body: "{}",
      }),
    );
    expect(signOut.status).toBe(200);

    expect(await signedInUser(studio.session.token)).toBeNull();
    expect(await signedInUser(dashboard)).toBe(memberUser.id);
  });

  it("can't be exchanged twice", async () => {
    const { memberUser, host } = await hostedProject();
    const url = await redirectTo(
      await authorizeStudio(`https://${host}/`, await dashboardSession(memberUser.id)),
    );
    const ott = url.searchParams.get("ott")!;
    await exchange(ott);

    const again = await testAuth().handler(
      new Request(`${API}/api/auth/one-time-token/verify`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: `https://${host}` },
        body: JSON.stringify({ token: ott }),
      }),
    );

    expect(again.status).toBe(400);
  });
});
