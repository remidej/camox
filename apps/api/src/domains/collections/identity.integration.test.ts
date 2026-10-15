import { generateUuidv7 } from "@camox/api-contract/ids";
import { describe, expect, it } from "vitest";

import { collection as customers } from "../../../../playground/src/collections/customers";
import {
  createProjectFixture,
  createRpcContext,
  createServiceContext,
  callSeedingLive,
} from "../../../test/fixtures";
import { runService } from "../../lib/run-service";
import { callTool } from "../agent/service";
import { collectionDefinitionProcedures as routes } from "./routes";
import { syncCollectionDefinitions } from "./service";

// Independent of the shared schema: version nibble 7, RFC 4122 variant.
const UUIDV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CLIENT_RECORD_ID = "019a2b3c-4d5e-7f60-8a1b-2c3d4e5f6a7b";
const content = { name: "Ada", company: "Engines", logo: null };

async function fixture() {
  const base = await createProjectFixture(`identity-${crypto.randomUUID()}`);
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
  return {
    ...base,
    options: { context },
    // AI tools write content, so they run in a draft: Live is read-only.
    toolContext: { ...context, draft: { id: generateUuidv7(), create: true } },
    scope: { projectSlug: base.project.slug, collectionId: id },
  };
}

describe("stable collection record identity", () => {
  it("creating a record returns a UUIDv7, or keeps a client-minted UUIDv7", async () => {
    const f = await fixture();
    const minted = await callSeedingLive(routes.createRecord, { ...f.scope, content }, f.options);
    expect(minted.id).toMatch(UUIDV7);

    const optimistic = await callSeedingLive(
      routes.createRecord,
      { ...f.scope, id: CLIENT_RECORD_ID, content },
      f.options,
    );
    expect(optimistic.id).toBe(CLIENT_RECORD_ID);
    expect(
      await callSeedingLive(routes.getRecord, { ...f.scope, id: CLIENT_RECORD_ID }, f.options),
    ).toMatchObject({ id: CLIENT_RECORD_ID });
  });

  it("procedures and AI tools reject a record id that isn't a UUIDv7", async () => {
    const f = await fixture();
    await callSeedingLive(routes.createRecord, { ...f.scope, content }, f.options);
    const target = f.scope;
    for (const id of [1, "1", crypto.randomUUID()]) {
      for (const [procedure, input] of [
        [routes.createRecord, { ...f.scope, id, content }],
        [routes.getRecord, { ...f.scope, id }],
        [routes.getRecordUsageCount, { ...f.scope, id }],
        [routes.editRecord, { ...target, id, content }],
        [routes.deleteRecord, { ...target, id }],
        [routes.recordMarkdown, { ...f.scope, id }],
      ] as const) {
        await expect(
          callSeedingLive(procedure as never, input as never, f.options),
        ).rejects.toMatchObject({
          code: "BAD_REQUEST",
        });
      }
      for (const name of ["createCollectionRecord", "getCollectionRecord"]) {
        expect(
          await runService(
            callTool(f.toolContext, {
              projectId: f.project.id,
              name,
              arguments: { collectionId: f.scope.collectionId, id, content },
            }),
          ),
        ).toMatchObject({ ok: false });
      }
    }
    expect(await callSeedingLive(routes.listRecords, f.scope, f.options)).toHaveLength(1);
  });
});
