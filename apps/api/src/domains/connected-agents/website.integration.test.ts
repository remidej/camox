import { describe, expect, it } from "vite-plus/test";

import { callTool, connectAgent, listTools } from "../../../test/connected-agents";
import { callSeedingLive, createProjectFixture, createRpcContext } from "../../../test/fixtures";
import { router } from "../../router";

/** A member's one project, with pages on Live. */
async function websiteWithPages() {
  const fixture = await createProjectFixture(crypto.randomUUID());
  const context = { context: createRpcContext(fixture.db, fixture.memberUser) };
  const createPage = (pathSegment: string, nickname: string) =>
    callSeedingLive(
      router.pages.create,
      {
        projectId: fixture.project.id,
        pathSegment,
        nickname,
        layoutId: fixture.layout.layoutId,
      },
      context,
    );
  await createPage("pricing", "Pricing");
  await createPage("about-us", "About");
  return fixture;
}

describe("get_website", () => {
  it("tells a member's Connected Agent their one website's name, address, locales and pages", async () => {
    const { memberUser, project } = await websiteWithPages();
    const { accessToken } = await connectAgent(memberUser.id);

    const result = await callTool(accessToken, "get_website");

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0]!.text)).toEqual({
      name: "Test project",
      address: `https://${project.slug}.camox.site`,
      locales: [{ tag: "en", default: true }],
      pages: expect.arrayContaining([
        { path: "/pricing", nickname: "Pricing" },
        { path: "/about-us", nickname: "About" },
      ]),
    });
  });

  it("takes no project from a member with one project", async () => {
    const { memberUser } = await websiteWithPages();
    const { accessToken } = await connectAgent(memberUser.id);

    const tools = await listTools(accessToken);

    const getWebsite = tools.find((tool) => tool.name === "get_website");
    expect(getWebsite).toBeDefined();
    expect(getWebsite!.inputSchema.properties ?? {}).not.toHaveProperty("project");
  });
});
