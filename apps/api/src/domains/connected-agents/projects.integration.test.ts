import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { describe, expect, it, onTestFinished } from "vite-plus/test";

import {
  callTool,
  connectAgent,
  listen,
  listTools,
  mcpRequest,
} from "../../../test/connected-agents";
import { createProjectFixture } from "../../../test/fixtures";
import { member, projects } from "../../schema";
import type { Bindings } from "../../types";

/**
 * A member of two organizations: their own, whose project is on `camox.site`, and a client's,
 * whose project has a Custom Domain.
 */
async function memberOfTwoProjects() {
  const own = await createProjectFixture(crypto.randomUUID());
  const client = await createProjectFixture(crypto.randomUUID());
  const domain = `${crypto.randomUUID()}.example.com`;
  const clientProject = { ...client.project, name: "Acme", customDomain: domain };
  await own.db
    .update(projects)
    .set({ name: "Acme", customDomain: domain })
    .where(eq(projects.id, client.project.id));
  await joinOrganization(own.db, own.memberUser.id, client.project.organizationId);
  return { ...own, clientProject };
}

async function joinOrganization(
  db: Awaited<ReturnType<typeof createProjectFixture>>["db"],
  userId: string,
  organizationId: string,
) {
  await db.insert(member).values({
    id: `membership-${crypto.randomUUID()}`,
    organizationId,
    userId,
    role: "member",
    createdAt: new Date(),
  });
}

describe("choosing a project", () => {
  it("asks a member with several projects which one, by slug, naming each by name and address", async () => {
    const { memberUser, project, clientProject } = await memberOfTwoProjects();
    const { accessToken } = await connectAgent(memberUser.id);

    const tools = await listTools(accessToken);

    const getWebsite = tools.find((tool) => tool.name === "get_website")!;
    const schema = getWebsite.inputSchema as {
      properties: { project: { enum: string[]; description: string } };
      required: string[];
    };
    expect(schema.required).toContain("project");
    expect(schema.properties.project.enum.toSorted()).toEqual(
      [project.slug, clientProject.slug].toSorted(),
    );
    const { description } = schema.properties.project;
    expect(description).toContain(
      `${project.slug}: Test project, https://${project.slug}.camox.site`,
    );
    expect(description).toContain(
      `${clientProject.slug}: Acme, https://${clientProject.customDomain}`,
    );
  });

  it("names a member's several projects, by name and address, in the server's instructions", async () => {
    const { memberUser, project, clientProject } = await memberOfTwoProjects();
    const { accessToken } = await connectAgent(memberUser.id);

    const { message } = await mcpRequest(accessToken, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "Claude", version: "1.0.0" },
    });

    const { instructions } = message!.result as { instructions?: string };
    expect(instructions).toContain(`Test project (https://${project.slug}.camox.site)`);
    expect(instructions).toContain(`Acme (https://${clientProject.customDomain})`);
  });

  it("answers a project the member can't reach with the projects they can", async () => {
    const { memberUser, project, clientProject } = await memberOfTwoProjects();
    const unreachable = await createProjectFixture(crypto.randomUUID());
    const { accessToken } = await connectAgent(memberUser.id);

    const result = await callTool(accessToken, "get_website", {
      project: unreachable.project.slug,
    });

    expect(result.isError).toBe(true);
    const { text } = result.content[0]!;
    expect(text).toContain(`${project.slug}: Test project, https://${project.slug}.camox.site`);
    expect(text).toContain(`${clientProject.slug}: Acme, https://${clientProject.customDomain}`);
  });

  it("tells a member's Connected Agent their tools changed once they gain a project", async () => {
    const own = await createProjectFixture(crypto.randomUUID());
    const client = await createProjectFixture(crypto.randomUUID());
    const { accessToken } = await connectAgent(own.memberUser.id);
    await listTools(accessToken);

    await joinOrganization(own.db, own.memberUser.id, client.project.organizationId);
    // A client that cached the list from when the member had one project leaves `project` out.
    const { message, notifications } = await mcpRequest(accessToken, "tools/call", {
      name: "get_website",
      arguments: {},
    });

    expect(notifications).toContain("notifications/tools/list_changed");
    const result = message!.result as { isError?: boolean; content: [{ text: string }] };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(client.project.slug);
    const getWebsite = (await listTools(accessToken)).find((tool) => tool.name === "get_website")!;
    expect(getWebsite.inputSchema.properties?.project).toMatchObject({
      enum: expect.arrayContaining([own.project.slug, client.project.slug]),
    });
  });

  it("reaches a project the member gained since their Connected Agent listed its tools", async () => {
    const { db, memberUser } = await memberOfTwoProjects();
    const { accessToken } = await connectAgent(memberUser.id);
    await listTools(accessToken);

    const gained = await createProjectFixture(crypto.randomUUID());
    await joinOrganization(db, memberUser.id, gained.project.organizationId);
    const result = await callTool(accessToken, "get_website", { project: gained.project.slug });

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({
      address: `https://${gained.project.slug}.camox.site`,
    });
  });

  it("gives a member with no project only a tool that explains how to create one", async () => {
    const { outsiderUser } = await createProjectFixture(crypto.randomUUID());
    const { accessToken } = await connectAgent(outsiderUser.id);

    const tools = await listTools(accessToken);

    expect(tools).toHaveLength(1);
    const result = await callTool(accessToken, tools[0]!.name);
    expect(result.isError).toBeFalsy();
    expect(result.content[0]!.text).toContain((env as unknown as Bindings).DASHBOARD_URL);
  });

  it("tells a listening Connected Agent its tools changed once the member gains a project", async () => {
    const bindings = env as unknown as Bindings;
    bindings.CONNECTED_AGENT_PROJECTS_POLL_MS = "10";
    onTestFinished(() => {
      delete bindings.CONNECTED_AGENT_PROJECTS_POLL_MS;
    });
    const own = await createProjectFixture(crypto.randomUUID());
    const client = await createProjectFixture(crypto.randomUUID());
    const { accessToken } = await connectAgent(own.memberUser.id);
    const subscription = await listen(accessToken);
    onTestFinished(subscription.close);

    await joinOrganization(own.db, own.memberUser.id, client.project.organizationId);

    await expect(subscription.next("notifications/tools/list_changed")).resolves.toMatchObject({
      method: "notifications/tools/list_changed",
    });
  });

  it("tells a member's Connected Agent their tools changed once they're down to one project", async () => {
    const { db, memberUser, project, clientProject } = await memberOfTwoProjects();
    const { accessToken } = await connectAgent(memberUser.id);
    await listTools(accessToken);

    await db
      .delete(member)
      .where(
        and(
          eq(member.userId, memberUser.id),
          eq(member.organizationId, clientProject.organizationId),
        ),
      );
    // A client that cached the list from when the member had two projects still names one.
    const { message, notifications } = await mcpRequest(accessToken, "tools/call", {
      name: "get_website",
      arguments: { project: project.slug },
    });

    expect(notifications).toContain("notifications/tools/list_changed");
    const result = message!.result as { isError?: boolean; content: [{ text: string }] };
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0].text)).toMatchObject({ name: "Test project" });
  });
});
