import { DRAFT_CREATE_HEADER, DRAFT_HEADER } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import type { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { collectionsProvider } from "../../../../../packages/ai-tools/src/providers/collections";
import { collection as customers } from "../../../../playground/src/collections/customers";
import {
  createProjectFixture,
  createRpcContext,
  createServiceContext,
  callSeedingLive,
} from "../../../test/fixtures";
import { runService } from "../../lib/run-service";
import type { BaseContext } from "../../orpc";
import { agentProcedures } from "../agent/routes";
import { collectionDefinitionProcedures as routes } from "./routes";
import { getCollectionRecord, syncCollectionDefinitions } from "./service";

async function fixture() {
  const base = await createProjectFixture(`record-procedures-${crypto.randomUUID()}`);
  const context = createRpcContext(base.db, base.memberUser);
  const { id, ...definition } = customers._internal;
  await runService(
    syncCollectionDefinitions(createServiceContext(base.db, null), {
      projectSlug: base.project.slug,
      deployToken: "test-deploy-token",
      autoCreate: false,
      definitions: [JSON.parse(JSON.stringify({ ...definition, collectionId: id }))],
    }),
  );
  return { ...base, context, scope: { projectSlug: base.project.slug, collectionId: id } };
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

  it("dispatches record tools through authenticated agent routes without crossing environments", async () => {
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
    const development = { ...drafted, environmentName: `dev:${f.memberUser.email}` };
    await runService(
      syncCollectionDefinitions(development, {
        projectSlug: f.scope.projectSlug,
        autoCreate: true,
        definitions: [],
      }),
    );
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

  it("AI tools use validated session-scoped services and ask approval to delete", async () => {
    const f = await fixture();
    const context = { ...f.context, projectId: f.project.id };
    const tools = await collectionsProvider(context);
    const tool = (name: string) => {
      const result = tools.find((entry) => entry.name === name);
      if (!result) throw new Error(`Missing tool: ${name}`);
      return result;
    };
    const run = (name: string, input: unknown) => tool(name).handler(input, context);
    expect(tool("deleteCollectionRecord").meta.risk).toBe("requiresApproval");
    expect(await run("listCollections", {})).toMatchObject([{ collectionId: "customers" }]);
    expect(await run("getCollection", { collectionId: "customers" })).toMatchObject({
      label: "name",
    });
    await expect(
      run("createCollectionRecord", { collectionId: "customers", content: { name: "" } }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(run("listCollections", { projectSlug: "foreign" })).rejects.toThrow();
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
