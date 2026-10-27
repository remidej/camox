import { DRAFT_CREATE_HEADER, DRAFT_HEADER } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { call } from "@orpc/server";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { createProjectFixture, createRpcContext, noArtifactFields } from "../../../test/fixtures";
import { InvalidInputError } from "../../lib/errors";
import { runService } from "../../lib/run-service";
import { pub } from "../../orpc";
import { blocks } from "../../schema";
import { accessTo } from "./access";
import * as overlay from "./overlay";

// A procedure that only resolves the request's draft scope through content access, so the tests
// run the real middleware that reads the draft headers.
const draftScopeProbe = pub
  .input(z.object({ projectId: z.number() }))
  .handler(({ context, input }) =>
    runService(
      Effect.scoped(
        Effect.map(accessTo(context, { project: input.projectId }, "public"), (a) => a.scope),
      ),
    ),
  );

// A write that stores a block in the draft, as a concurrent first edit would, and then fails.
const storeThenFailProbe = pub
  .input(z.object({ projectId: z.number() }))
  .handler(({ context, input }) =>
    runService(
      Effect.scoped(
        Effect.flatMap(accessTo(context, { project: input.projectId }, "write"), ({ scope }) =>
          overlay
            .insert(
              context.db,
              scope,
              blocks,
              {
                projectId: input.projectId,
                type: "hero",
                content: {},
                position: "a0",
                createdAt: 1,
                updatedAt: 1,
              },
              noArtifactFields,
            )
            .pipe(Effect.andThen(new InvalidInputError({ message: "Failed after storing" }))),
        ),
      ),
    ),
  );

type Caller = "member" | "outsider" | "anonymous";

async function fixture() {
  const base = await createProjectFixture(`drafts-scope-${crypto.randomUUID()}`);

  const users = { member: base.memberUser, outsider: base.outsiderUser, anonymous: null };

  function resolve(caller: Caller, headers: Record<string, string> = {}) {
    return call(
      draftScopeProbe,
      { projectId: base.project.id },
      { context: createRpcContext(base.db, users[caller], headers) },
    );
  }

  const storeThenFail = (headers: Record<string, string>) =>
    call(
      storeThenFailProbe,
      { projectId: base.project.id },
      { context: createRpcContext(base.db, base.memberUser, headers) },
    );

  return { ...base, resolve, storeThenFail };
}

describe("draft request scope", () => {
  it("rejects a draft id that isn't a UUIDv7", async () => {
    const { resolve } = await fixture();

    await expect(
      resolve("member", { [DRAFT_HEADER]: "not-a-draft", [DRAFT_CREATE_HEADER]: "1" }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("keeps a draft whose starting write failed once content is stored in it", async () => {
    const { project, resolve, storeThenFail } = await fixture();
    const draftId = generateUuidv7();

    await expect(
      storeThenFail({ [DRAFT_HEADER]: draftId, [DRAFT_CREATE_HEADER]: "1" }),
    ).rejects.toMatchObject({ status: 400 });

    await expect(resolve("member", { [DRAFT_HEADER]: draftId })).resolves.toEqual({
      id: draftId,
      kind: "regular",
      projectId: project.id,
    });
  });

  it("rejects a missing draft named without the create header", async () => {
    const { resolve } = await fixture();
    const draftId = generateUuidv7();

    await expect(resolve("member", { [DRAFT_HEADER]: draftId })).rejects.toMatchObject({
      status: 404,
      message: expect.stringContaining(draftId),
    });
    // Rejecting it didn't start it either.
    await expect(resolve("member", { [DRAFT_HEADER]: draftId })).rejects.toMatchObject({
      status: 404,
    });
  });
});
