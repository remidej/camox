import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";

import { createProjectFixture } from "../../../test/fixtures";
import { createDb } from "../../db";
import { session } from "../../schema";
import type { Bindings } from "../../types";
import { createAuth, getCookieDomain } from "./routes";

describe("getCookieDomain", () => {
  it.each([
    ["https://api.camox.dev", ".camox.dev"],
    ["https://app.camox.dev", ".camox.dev"],
    ["https://camox.dev", ".camox.dev"],
    ["http://localhost:3274", undefined],
    ["http://camox-worktree-one.localhost:8787", undefined],
    ["http://camox-worktree-two.localhost:8788", undefined],
    ["http://127.0.0.1:8787", undefined],
    ["http://[::1]:8787", undefined],
    ["https://localhost.example.com", ".localhost.example.com"],
    ["not a url", undefined],
    ["", undefined],
  ])("maps %s to %s", (siteUrl, expected) => {
    expect(getCookieDomain(siteUrl)).toBe(expected);
  });
});

describe("organization invitations", () => {
  it("creates the invitation and schedules its email", async () => {
    const suffix = crypto.randomUUID();
    const { memberUser, project } = await createProjectFixture(suffix);
    const db = createDb(env.DB);
    const sessionToken = `session-${suffix}`;
    const send = vi.fn().mockResolvedValue({});
    const now = new Date();

    await db.insert(session).values({
      id: `session-id-${suffix}`,
      token: sessionToken,
      userId: memberUser.id,
      activeOrganizationId: project.organizationId,
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
      updatedAt: now,
    });

    const auth = createAuth(
      db,
      {
        BETTER_AUTH_SECRET: "test-secret",
        DASHBOARD_URL: "https://app.camox.dev",
        EMAIL: { send },
        GITHUB_CLIENT_ID: "test-client-id",
        GITHUB_CLIENT_SECRET: "test-client-secret",
        GOOGLE_CLIENT_ID: "test-client-id",
        GOOGLE_CLIENT_SECRET: "test-client-secret",
      } as unknown as Bindings,
      "http://localhost",
    );
    const response = await auth.handler(
      new Request("http://localhost/api/auth/organization/invite-member", {
        method: "POST",
        headers: {
          authorization: `Bearer ${sessionToken}`,
          "content-type": "application/json",
          origin: "http://localhost",
        },
        body: JSON.stringify({
          email: `invitee-${suffix}@example.com`,
          organizationId: project.organizationId,
          role: "member",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: `invitee-${suffix}@example.com`,
        html: expect.stringContaining("https://app.camox.dev/accept-invitation?invitationId="),
      }),
    );
  });
});
