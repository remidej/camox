import { call } from "@orpc/server";
import { describe, expect, it } from "vite-plus/test";

import {
  authorize,
  callTool,
  connectAgent,
  type ConnectOptions,
} from "../../../test/connected-agents";
import {
  createProjectFixture,
  createRpcContext,
  createSessionFixture,
} from "../../../test/fixtures";
import { router } from "../../router";

/** What the consent screen shows a member authorizing a Connected Agent that connects with `options`. */
async function consentScreen(options: ConnectOptions) {
  const { db, memberUser } = await createProjectFixture(crypto.randomUUID());
  const { response } = await authorize(await createSessionFixture(memberUser.id), options);
  expect(response.status).toBe(302);
  const consentPage = new URL(response.headers.get("location")!);
  return call(
    router.connectedAgents.consent,
    { oauthQuery: consentPage.search.slice(1) },
    { context: createRpcContext(db, memberUser) },
  );
}

describe("the consent screen", () => {
  it("names a client whose name comes from its Client ID Metadata Document as verified, and the two scopes", async () => {
    const screen = await consentScreen({ clientName: "Claude" });

    expect(screen.client).toEqual({ name: "Claude", verified: true });
    expect(screen.scopes.map(({ scope }) => scope)).toEqual(["website:read", "drafts:write"]);
    for (const { description } of screen.scopes) expect(description).toBeTruthy();
  });

  it("grants both scopes to a Connected Agent that asks for only one of them", async () => {
    const asked = { clientName: "Claude", scope: "website:read offline_access" };
    const screen = await consentScreen(asked);
    const { memberUser } = await createProjectFixture(crypto.randomUUID());
    const { scope } = await connectAgent(memberUser.id, asked);

    expect(screen.scopes.map(({ scope }) => scope)).toEqual(["website:read", "drafts:write"]);
    expect(scope.split(" ")).toEqual(expect.arrayContaining(["website:read", "drafts:write"]));
  });

  it("marks the name of a client registered through Dynamic Client Registration as not verified", async () => {
    const screen = await consentScreen({ clientName: "Claude", registration: "dynamic" });

    expect(screen.client).toEqual({ name: "Claude", verified: false });
  });

  it("refuses a request the authorization server didn't sign", async () => {
    const { db, memberUser } = await createProjectFixture(crypto.randomUUID());
    const forged = new URLSearchParams({ client_id: "anything", scope: "website:read", sig: "x" });

    await expect(
      call(
        router.connectedAgents.consent,
        { oauthQuery: forged.toString() },
        { context: createRpcContext(db, memberUser) },
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("Dynamic Client Registration", () => {
  it("connects a Connected Agent that reads the website", async () => {
    const { memberUser } = await createProjectFixture(crypto.randomUUID());
    const { accessToken } = await connectAgent(memberUser.id, { registration: "dynamic" });

    const result = await callTool(accessToken, "get_website");

    expect(result.isError).toBeFalsy();
  });
});
