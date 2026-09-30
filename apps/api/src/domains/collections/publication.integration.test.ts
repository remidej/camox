import { call } from "@orpc/server";
import { describe, expect, it } from "vitest";

import { collectionsProvider } from "../../../../../packages/ai-tools/src/providers/collections";
import { collection as customers } from "../../../../playground/src/collections/customers";
import { createProjectFixture, createServiceContext } from "../../../test/fixtures";
import type { BaseContext } from "../../orpc";
import { agentProcedures } from "../agent/routes";
import { collectionDefinitionProcedures as routes } from "./routes";
import { getCollectionRecord, readRecord, syncCollectionDefinitions } from "./service";

async function fixture() {
  const base = await createProjectFixture(`publication-${crypto.randomUUID()}`);
  const service = createServiceContext(base.db, base.memberUser);
  const context: BaseContext = {
    ...service,
    headers: new Headers(),
    session: {
      id: "session",
      token: "test",
      userId: base.memberUser.id,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };
  const { id, ...definition } = customers._internal;
  await syncCollectionDefinitions(createServiceContext(base.db, null), {
    projectSlug: base.project.slug,
    deployToken: "test-deploy-token",
    autoCreate: false,
    definitions: [JSON.parse(JSON.stringify({ ...definition, collectionId: id }))],
  });
  return {
    ...base,
    context,
    scope: { projectSlug: base.project.slug, collectionId: id },
    publicContext: createServiceContext(base.db, null),
  };
}

describe("standalone customer publication", () => {
  it("discards only published drafts with scoped version checks and preserves live content", async () => {
    const f = await fixture();
    const options = { context: f.context };
    const created = await call(
      routes.createRecord,
      {
        ...f.scope,
        content: { name: "Ada", company: "Engines", logo: null },
      },
      options,
    );
    const target = { ...f.scope, id: created.id };
    await expect(
      call(routes.discardRecord, { ...target, expectedVersion: created.version }, options),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const published = await call(
      routes.publishRecord,
      { ...target, expectedVersion: created.version },
      options,
    );
    const edited = await call(
      routes.editRecord,
      {
        ...target,
        expectedVersion: published.record.version,
        content: { name: "Private", company: "Draft", logo: null },
      },
      options,
    );
    await expect(
      call(
        routes.discardRecord,
        {
          ...target,
          expectedVersion: published.record.version,
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      call(
        routes.discardRecord,
        {
          ...target,
          collectionId: "other",
          expectedVersion: edited.version,
        },
        options,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const restored = await call(
      routes.discardRecord,
      { ...target, expectedVersion: edited.version },
      options,
    );
    expect(restored.draft).toEqual(created.draft);
    expect(restored.version).toBe(edited.version + 1);
    expect(restored.publishedRevisionId).toBe(published.record.publishedRevisionId);
    expect(await readRecord(f.publicContext, target)).toMatchObject({ content: created.draft });
    expect(await call(routes.listRecords, f.scope, options)).toMatchObject([
      { status: "published" },
    ]);
  });

  it("authenticates routes and creates/edits/publishes without a block reference", async () => {
    const f = await fixture();
    const options = { context: f.context };
    const created = await call(
      routes.createRecord,
      {
        ...f.scope,
        content: { name: "Ada", company: "Analytical Engines", logo: null },
      },
      options,
    );
    const target = { ...f.scope, id: created.id };
    const stale = { ...target, expectedVersion: created.version };
    const edited = await call(
      routes.editRecord,
      {
        ...stale,
        content: { name: "Ada Lovelace", company: "Analytical Engines", logo: null },
      },
      options,
    );
    expect(await readRecord(f.publicContext, target)).toBeNull();
    const mutations = [
      (input: typeof stale, context: BaseContext) => call(routes.publishRecord, input, { context }),
      (input: typeof stale, context: BaseContext) =>
        call(routes.unpublishRecord, input, { context }),
      (input: typeof stale, context: BaseContext) => call(routes.discardRecord, input, { context }),
    ];
    for (const mutate of mutations) {
      await expect(
        mutate(
          { ...target, expectedVersion: edited.version },
          {
            ...f.context,
            session: null,
          },
        ),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      await expect(
        mutate(
          { ...target, expectedVersion: edited.version },
          {
            ...f.context,
            user: f.outsiderUser,
          },
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(mutate(stale, f.context)).rejects.toMatchObject({ code: "CONFLICT" });
    }
    const published = await call(
      routes.publishRecord,
      {
        ...target,
        expectedVersion: edited.version,
      },
      options,
    );
    expect(await call(routes.listRecords, f.scope, options)).toMatchObject([
      { status: "published" },
    ]);
    const draft = await call(
      routes.editRecord,
      {
        ...target,
        expectedVersion: published.record.version,
        content: { name: "Private draft", company: "Private company", logo: null },
      },
      options,
    );
    expect(await call(routes.listRecords, f.scope, options)).toMatchObject([
      { status: "modified" },
    ]);
    expect(await readRecord(f.publicContext, target)).toMatchObject({
      content: { name: "Ada Lovelace" },
    });
    const republished = await call(
      routes.publishRecord,
      { ...target, expectedVersion: draft.version },
      options,
    );
    expect(await readRecord(f.publicContext, target)).toMatchObject({
      content: draft.draft,
    });
    expect(await call(routes.listRecords, f.scope, options)).toMatchObject([
      { status: "published" },
    ]);
    const removed = await call(
      routes.unpublishRecord,
      {
        ...target,
        expectedVersion: republished.record.version,
      },
      options,
    );
    expect(removed.draft).toEqual(draft.draft);
    expect(await readRecord(f.publicContext, target)).toBeNull();
    expect(await call(routes.listRecords, f.scope, options)).toMatchObject([{ status: "draft" }]);
  });

  it("discovers and dispatches registered tools through authenticated agent routes without crossing environments", async () => {
    const f = await fixture();
    const projectId = f.project.id;
    const options = { context: f.context };
    const tools = await call(agentProcedures.listTools, { projectId }, options);
    expect(
      tools.find((tool) => tool.name === "publishCollectionRecord")?.inputSchema,
    ).toMatchObject({
      type: "object",
      properties: { collectionId: { type: "string" }, expectedVersion: { type: "integer" } },
      additionalProperties: false,
    });
    const invoke = (context: BaseContext, name: string, args: unknown) =>
      call(agentProcedures.callTool, { projectId, name, arguments: args }, { context });
    const created = await invoke(f.context, "createCollectionRecord", {
      collectionId: "customers",
      content: { name: "Transport customer", company: "Example", logo: null },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error.message);
    const record = created.result as Awaited<ReturnType<typeof getCollectionRecord>>;
    const target = { collectionId: "customers", id: record.id, expectedVersion: record.version };
    const development = { ...f.context, environmentName: `dev:${f.memberUser.email}` };
    await syncCollectionDefinitions(development, {
      projectSlug: f.scope.projectSlug,
      autoCreate: true,
      definitions: [],
    });
    expect(await invoke(development, "listCollections", {})).toEqual({ ok: true, result: [] });
    expect(await invoke(development, "publishCollectionRecord", target)).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    expect(await readRecord(f.publicContext, { ...f.scope, id: record.id })).toBeNull();
    expect(await invoke(f.context, "publishCollectionRecord", target)).toMatchObject({ ok: true });
    expect(await invoke(f.context, "publishCollectionRecord", target)).toMatchObject({
      ok: false,
      error: { code: "CONFLICT" },
    });
    await expect(
      invoke({ ...f.context, session: null }, "publishCollectionRecord", target),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      invoke({ ...f.context, user: f.outsiderUser }, "publishCollectionRecord", target),
    ).rejects.toThrow();
  });

  it("AI tools use validated session-scoped services and require publication approval", async () => {
    const f = await fixture();
    const context = { ...f.context, projectId: f.project.id };
    const tools = await collectionsProvider(context);
    const tool = (name: string) => {
      const result = tools.find((entry) => entry.name === name);
      if (!result) throw new Error(`Missing tool: ${name}`);
      return result;
    };
    const run = (name: string, input: unknown) => tool(name).handler(input, context);
    for (const name of [
      "publishCollectionRecord",
      "unpublishCollectionRecord",
      "deleteCollectionRecord",
    ]) {
      expect(tool(name).meta.risk).toBe("requiresApproval");
    }
    expect(await run("listCollections", {})).toMatchObject([{ collectionId: "customers" }]);
    expect(await run("getCollection", { collectionId: "customers" })).toMatchObject({
      label: "name",
    });
    await expect(
      run("createCollectionRecord", {
        collectionId: "customers",
        content: { name: "" },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(run("listCollections", { projectSlug: "foreign" })).rejects.toThrow();
    const created = (await run("createCollectionRecord", {
      collectionId: "customers",
      content: { name: "Ada", company: "Engines", logo: null },
    })) as Awaited<ReturnType<typeof getCollectionRecord>>;
    const target = { collectionId: "customers", id: created.id };
    expect(await run("getCollectionRecord", target)).toEqual(created);
    const edited = (await run("editCollectionRecord", {
      ...target,
      expectedVersion: created.version,
      content: { name: "Ada Lovelace", company: "Engines", logo: null },
    })) as typeof created;
    await expect(
      run("publishCollectionRecord", {
        ...target,
        expectedVersion: created.version,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await run("publishCollectionRecord", { ...target, expectedVersion: edited.version });
    expect(await readRecord(f.publicContext, { ...target, ...f.scope })).toMatchObject({
      content: { name: "Ada Lovelace" },
    });
    const published = await getCollectionRecord(f.context, { ...target, ...f.scope });
    expect(await run("listCollectionRecords", { collectionId: "customers" })).toMatchObject([
      { status: "published" },
    ]);
    await run("unpublishCollectionRecord", { ...target, expectedVersion: published.version });
    expect(await readRecord(f.publicContext, { ...target, ...f.scope })).toBeNull();
    const draft = await getCollectionRecord(f.context, { ...target, ...f.scope });
    await run("deleteCollectionRecord", { ...target, expectedVersion: draft.version });
    expect(await run("listCollectionRecords", { collectionId: "customers" })).toEqual([]);
    const outsiderContext = { ...context, user: f.outsiderUser };
    const outsiderTools = await collectionsProvider(outsiderContext);
    await expect(outsiderTools[0].handler({}, outsiderContext)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
