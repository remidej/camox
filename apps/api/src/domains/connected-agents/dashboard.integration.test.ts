import { call } from "@orpc/server";
import { describe, expect, it } from "vite-plus/test";

import { callTool, connectAgent, mcpRequest } from "../../../test/connected-agents";
import { createProjectFixture, createRpcContext } from "../../../test/fixtures";
import { router } from "../../router";

type Member = Awaited<ReturnType<typeof createProjectFixture>>["memberUser"];

const asMember = (db: Awaited<ReturnType<typeof createProjectFixture>>["db"], who: Member) => ({
  context: createRpcContext(db, who),
});

describe("the member's Connected Agents", () => {
  it("lists each client the member connected, verified or not, with when it was connected and last used", async () => {
    const { db, memberUser } = await createProjectFixture(crypto.randomUUID());
    // Better Auth records when a consent was given to the second.
    const before = Math.floor(Date.now() / 1000) * 1000;
    const claude = await connectAgent(memberUser.id, { clientName: "Claude" });
    await connectAgent(memberUser.id, { clientName: "Some agent", registration: "dynamic" });
    const connected = Date.now();

    await callTool(claude.accessToken, "get_website");

    const agents = await call(router.connectedAgents.list, {}, asMember(db, memberUser));
    expect(agents.map(({ client }) => client)).toEqual(
      expect.arrayContaining([
        { name: "Claude", verified: true },
        { name: "Some agent", verified: false },
      ]),
    );
    expect(agents).toHaveLength(2);
    const used = agents.find(({ client }) => client.name === "Claude")!;
    const unused = agents.find(({ client }) => client.name === "Some agent")!;
    for (const { connectedAt } of agents) {
      expect(connectedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(connectedAt.getTime()).toBeLessThanOrEqual(connected);
    }
    expect(used.lastUsedAt!.getTime()).toBeGreaterThanOrEqual(connected);
    expect(unused.lastUsedAt).toBeNull();
  });

  it("never lists another member's Connected Agents", async () => {
    const { db, memberUser, outsiderUser } = await createProjectFixture(crypto.randomUUID());
    await connectAgent(memberUser.id, { clientName: "Claude" });

    const agents = await call(router.connectedAgents.list, {}, asMember(db, outsiderUser));

    expect(agents).toEqual([]);
  });
});

describe("disconnecting a Connected Agent", () => {
  it("refuses its next MCP call and its refresh, and drops it from the list", async () => {
    const { db, memberUser } = await createProjectFixture(crypto.randomUUID());
    const claude = await connectAgent(memberUser.id, { clientName: "Claude" });
    const [agent] = await call(router.connectedAgents.list, {}, asMember(db, memberUser));

    await call(router.connectedAgents.disconnect, { id: agent!.id }, asMember(db, memberUser));

    const { response } = await mcpRequest(claude.accessToken, "tools/list");
    expect(response.status).toBe(401);
    const refreshed = await claude.tryRefresh();
    expect(refreshed.status).toBe(400);
    expect(await refreshed.json()).toMatchObject({ error: "invalid_grant" });
    expect(await call(router.connectedAgents.list, {}, asMember(db, memberUser))).toEqual([]);
  });

  it("can't disconnect another member's Connected Agent", async () => {
    const { db, memberUser, outsiderUser } = await createProjectFixture(crypto.randomUUID());
    const claude = await connectAgent(memberUser.id, { clientName: "Claude" });
    const [agent] = await call(router.connectedAgents.list, {}, asMember(db, memberUser));

    await expect(
      call(router.connectedAgents.disconnect, { id: agent!.id }, asMember(db, outsiderUser)),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect((await callTool(claude.accessToken, "get_website")).isError).toBeFalsy();
    expect((await claude.tryRefresh()).status).toBe(200);
  });
});
