import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";

import { authorize, callTool, connectAgent, mcpRequest } from "../../../test/connected-agents";
import { createProjectFixture, createSessionFixture } from "../../../test/fixtures";
import { createDb } from "../../db";
import app from "../../index";
import { member } from "../../schema";
import type { Bindings } from "../../types";
import { createAuth } from "../auth/routes";

const API = "http://localhost";

/** The `resource_metadata` URL a `WWW-Authenticate` challenge points a Connected Agent to. */
function resourceMetadataUrl(response: Response) {
  const challenge = response.headers.get("www-authenticate") ?? "";
  return /resource_metadata="([^"]+)"/.exec(challenge)?.[1];
}

describe("discovering how to connect", () => {
  it("answers a request with no token with a 401 naming the server's Protected Resource Metadata", async () => {
    const response = await app.request(
      `${API}/mcp`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      },
      env,
    );

    expect(response.status).toBe(401);
    const metadataUrl = resourceMetadataUrl(response);
    expect(metadataUrl).toBeDefined();

    const metadata = (await (await app.request(metadataUrl!, {}, env)).json()) as {
      resource: string;
      authorization_servers: string[];
    };
    expect(metadata.resource).toBe(`${API}/mcp`);

    const [issuer] = metadata.authorization_servers;
    const issuerPath = new URL(issuer!).pathname;
    const server = (await (
      await app.request(`${API}/.well-known/oauth-authorization-server${issuerPath}`, {}, env)
    ).json()) as { issuer: string; authorization_endpoint: string; token_endpoint: string };
    expect(server.issuer).toBe(issuer);
    expect(server.authorization_endpoint).toMatch(/^http:\/\/localhost\//);
    expect(server.token_endpoint).toMatch(/^http:\/\/localhost\//);
  });
});

describe("connecting", () => {
  it("stays connected by trading its refresh token for a new access token", async () => {
    const { memberUser } = await createProjectFixture(crypto.randomUUID());
    const { refreshToken, refresh } = await connectAgent(memberUser.id);
    expect(refreshToken).toBeDefined();

    const { access_token } = await refresh();

    expect((await callTool(access_token, "get_website")).isError).toBeFalsy();
  });

  it.each([
    ["at a private address", "https://agent.internal/clients/Claude"],
    ["that redirects", "https://website.camox.test/moved/Claude"],
  ])("refuses a Client ID Metadata Document %s", async (_, clientId) => {
    const { memberUser } = await createProjectFixture(crypto.randomUUID());

    const { response } = await authorize(await createSessionFixture(memberUser.id), { clientId });

    // Never on to the consent screen: an error, or a redirect saying so.
    const location = response.headers.get("location");
    expect(location === null || new URL(location).searchParams.has("error")).toBe(true);
    expect(location ?? "").not.toContain("/connect-agent/consent");
  });
});

describe("calling the MCP server", () => {
  it("refuses a request with no token", async () => {
    const { response } = await mcpRequest(null, "tools/list");

    expect(response.status).toBe(401);
  });

  it("refuses a token Camox's authorization server issued for another audience", async () => {
    const { memberUser } = await createProjectFixture(crypto.randomUUID());
    const { clientId } = await connectAgent(memberUser.id);
    // Signed with the authorization server's own keys, for the same member and client, as a
    // token for the MCP server would be, except for whom it's for.
    const { token } = await createAuth(
      createDb(env.DB),
      env as unknown as Bindings,
      API,
    ).api.signJWT({
      body: {
        payload: {
          sub: memberUser.id,
          azp: clientId,
          scope: "website:read drafts:write",
          iss: `${API}/api/auth`,
          aud: "https://elsewhere.example/mcp",
        },
      },
    });

    const { response } = await mcpRequest(token, "tools/list");

    expect(response.status).toBe(401);
  });

  it("refuses a member removed from the project's organization on their next call", async () => {
    const { db, memberUser, project } = await createProjectFixture(crypto.randomUUID());
    const { accessToken } = await connectAgent(memberUser.id);
    expect((await callTool(accessToken, "get_website")).isError).toBeFalsy();

    await db.delete(member).where(eq(member.userId, memberUser.id));
    // With no project left, the member has no website tools: the call names one they don't have.
    const { message } = await mcpRequest(accessToken, "tools/call", {
      name: "get_website",
      arguments: {},
    });

    expect(message?.error).toBeDefined();
    expect(JSON.stringify(message)).not.toContain(project.slug);
  });
});
