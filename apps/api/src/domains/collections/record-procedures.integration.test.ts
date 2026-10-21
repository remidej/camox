import { DEVELOPMENT_DRAFT, DRAFT_CREATE_HEADER, DRAFT_HEADER } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import type { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { collectionsProvider } from "../../../../../packages/ai-tools/src/providers/collections";
import { toolProviders } from "../../../../../packages/ai-tools/src/registry";
import { resolveTools } from "../../../../../packages/ai-tools/src/resolve";
import type { ToolSurface } from "../../../../../packages/ai-tools/src/types";
import { collection as customers } from "../../../../playground/src/collections/customers";
import {
  createProjectFixture,
  createRpcContext,
  callSeedingLive,
  syncDefinitionSet,
} from "../../../test/fixtures";
import type { BaseContext } from "../../orpc";
import { agentProcedures } from "../agent/routes";
import { collectionDefinitionProcedures as routes } from "./routes";
import { getCollectionRecord } from "./service";

async function fixture() {
  const base = await createProjectFixture(`record-procedures-${crypto.randomUUID()}`);
  const context = createRpcContext(base.db, base.memberUser);
  const { id, ...definition } = customers._internal;
  await syncDefinitionSet(base.db, base.project, {
    collections: [JSON.parse(JSON.stringify({ ...definition, collectionId: id }))],
  });
  return { ...base, context, scope: { projectUuid: base.project.uuid, collectionId: id } };
}

describe("collection record procedures", () => {
  it("offers no way to publish, unpublish, discard or restore a single record", () => {
    for (const name of [
      "publishRecord",
      "unpublishRecord",
      "discardRecord",
      "checkpointRecord",
      "restoreRecord",
    ]) {
      expect(routes).not.toHaveProperty(name);
    }
  });

  it("authenticates every write, and the edit reads back as the record's content", async () => {
    const f = await fixture();
    const options = { context: f.context };
    const created = await callSeedingLive(
      routes.createRecord,
      { ...f.scope, content: { name: "Ada", company: "Analytical Engines", logo: null } },
      options,
    );
    const target = { ...f.scope, id: created.id };
    const writes = [
      (context: BaseContext) =>
        callSeedingLive(
          routes.editRecord,
          { ...target, content: { name: "Ada", company: "", logo: null } },
          { context },
        ),
      (context: BaseContext) => callSeedingLive(routes.deleteRecord, target, { context }),
    ];
    for (const write of writes) {
      await expect(write({ ...f.context, session: null })).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      await expect(write({ ...f.context, user: f.outsiderUser })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    }
    await callSeedingLive(
      routes.editRecord,
      { ...target, content: { name: "Ada Lovelace", company: "Analytical Engines", logo: null } },
      options,
    );
    expect(await callSeedingLive(routes.getRecord, target, options)).toMatchObject({
      content: { name: "Ada Lovelace" },
    });
    expect(await callSeedingLive(routes.listRecords, f.scope, options)).toEqual([
      { id: created.id, label: "Ada Lovelace", duplicatePageValue: false },
    ]);
    await callSeedingLive(routes.deleteRecord, target, options);
    expect(await callSeedingLive(routes.listRecords, f.scope, options)).toEqual([]);
  });

  it("offers the studio agent content tools and the publish preview, never publishing, discarding or retagging Live", async () => {
    const f = await fixture();
    const context = { ...f.context, draft: null, projectId: f.project.id };
    const names = async (surface: ToolSurface) =>
      (await resolveTools(toolProviders, context, surface)).map((tool) => tool.name);
    const cli = await names("cli");
    const studioAgent = await names("studio-agent");
    expect(cli).toEqual(expect.arrayContaining(["publishDraft", "discardDraft"]));
    expect(studioAgent).not.toContain("publishDraft");
    expect(studioAgent).not.toContain("discardDraft");
    expect(studioAgent).not.toContain("setDefaultLocaleTag");
    expect(studioAgent).toEqual(
      expect.arrayContaining([
        "createCollectionRecord",
        "deleteCollectionRecord",
        "editBlock",
        "previewPublish",
      ]),
    );
    // The CLI keeps every tool there is.
    const all = (
      await Promise.all(toolProviders.map(async (provider) => provider(context)))
    ).flat();
    expect(cli).toEqual(all.map((tool) => tool.name));
  });

  it("dispatches record tools through authenticated agent routes without crossing drafts", async () => {
    const f = await fixture();
    const projectId = f.project.id;
    const tools = await callSeedingLive(
      agentProcedures.listTools,
      { projectId },
      { context: f.context },
    );
    const names = tools.map((tool) => tool.name);
    expect(names).not.toContain("publishCollectionRecord");
    expect(names).not.toContain("unpublishCollectionRecord");
    expect(tools.find((tool) => tool.name === "deleteCollectionRecord")?.inputSchema).toMatchObject(
      {
        type: "object",
        properties: { collectionId: { type: "string" }, id: { type: "string" } },
        additionalProperties: false,
      },
    );
    expect(
      tools.find((tool) => tool.name === "deleteCollectionRecord")?.inputSchema,
    ).not.toHaveProperty("properties.expectedVersion");
    // AI tools write content, so they run in a draft: Live is read-only.
    const drafted = createRpcContext(f.db, f.memberUser, {
      [DRAFT_HEADER]: generateUuidv7(),
      [DRAFT_CREATE_HEADER]: "1",
    });
    const invoke = (context: BaseContext, name: string, args: unknown) =>
      callSeedingLive(agentProcedures.callTool, { projectId, name, arguments: args }, { context });
    const created = await invoke(drafted, "createCollectionRecord", {
      collectionId: "customers",
      content: { name: "Transport customer", company: "Example", logo: null },
    });
    if (!created.ok) throw new Error(created.error.message);
    const record = created.result as Effect.Success<ReturnType<typeof getCollectionRecord>>;
    const target = { collectionId: "customers", id: record.id };
    // The development draft has its own definitions, here none: Live's collection isn't in it.
    const development = createRpcContext(f.db, f.memberUser, {
      [DRAFT_HEADER]: DEVELOPMENT_DRAFT,
    });
    await syncDefinitionSet(f.db, f.project, {}, { as: f.memberUser });
    expect(await invoke(development, "listCollections", {})).toEqual({ ok: true, result: [] });
    expect(await invoke(development, "deleteCollectionRecord", target)).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    await expect(
      invoke({ ...drafted, session: null }, "deleteCollectionRecord", target),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(await invoke(drafted, "deleteCollectionRecord", target)).toMatchObject({ ok: true });
  });

  it("AI tools use validated, project-scoped services", async () => {
    const f = await fixture();
    // AI tools work in a draft: Live is read-only (ADR 0003).
    const context = {
      ...f.context,
      draft: { id: generateUuidv7(), create: true },
      projectId: f.project.id,
    };
    const tools = await collectionsProvider(context);
    const tool = (name: string) => {
      const result = tools.find((entry) => entry.name === name);
      if (!result) throw new Error(`Missing tool: ${name}`);
      return result;
    };
    const run = (name: string, input: unknown) => tool(name).handler(input, context);
    expect(await run("listCollections", {})).toMatchObject([{ collectionId: "customers" }]);
    expect(await run("getCollection", { collectionId: "customers" })).toMatchObject({
      label: "name",
    });
    await expect(
      run("createCollectionRecord", { collectionId: "customers", content: { name: "" } }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(run("listCollections", { projectUuid: generateUuidv7() })).rejects.toThrow();
    const created = (await run("createCollectionRecord", {
      collectionId: "customers",
      content: { name: "Ada", company: "Engines", logo: null },
    })) as Effect.Success<ReturnType<typeof getCollectionRecord>>;
    const target = { collectionId: "customers", id: created.id };
    expect(await run("getCollectionRecord", target)).toEqual(created);
    await run("editCollectionRecord", {
      ...target,
      content: { name: "Ada Lovelace", company: "Engines", logo: null },
    });
    expect(await run("listCollectionRecords", { collectionId: "customers" })).toEqual([
      { id: created.id, label: "Ada Lovelace", duplicatePageValue: false },
    ]);
    await run("deleteCollectionRecord", target);
    expect(await run("listCollectionRecords", { collectionId: "customers" })).toEqual([]);
    const outsiderContext = { ...context, user: f.outsiderUser };
    const outsiderTools = await collectionsProvider(outsiderContext);
    await expect(outsiderTools[0].handler({}, outsiderContext)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
