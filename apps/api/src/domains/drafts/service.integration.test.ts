import { DRAFT_CREATE_HEADER, DRAFT_HEADER } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createProjectFixture, createRpcContext } from "../../../test/fixtures";
import { pub } from "../../orpc";
import { drafts, member } from "../../schema";
import { requireDraftScope } from "./service";

// A procedure that only resolves the request's draft scope, so the tests run the real
// middleware the way block procedures will.
const draftScopeProbe = pub
  .input(z.object({ projectId: z.number() }))
  .handler(({ context, input }) => requireDraftScope(context, input.projectId));

type Caller = "member" | "outsider" | "anonymous";

async function fixture() {
  const base = await createProjectFixture(`drafts-scope-${crypto.randomUUID()}`);
  const other = await createProjectFixture(`drafts-scope-other-${crypto.randomUUID()}`);

  const users = { member: base.memberUser, outsider: base.outsiderUser, anonymous: null };

  function resolve(
    caller: Caller,
    headers: Record<string, string> = {},
    projectId = base.project.id,
  ) {
    return call(
      draftScopeProbe,
      { projectId },
      { context: createRpcContext(base.db, users[caller], headers) },
    );
  }

  return { ...base, other, resolve };
}

describe("draft request scope", () => {
  it("resolves to Live when the request names no draft, for anyone", async () => {
    const { resolve } = await fixture();

    await expect(resolve("anonymous")).resolves.toBeNull();
    await expect(resolve("outsider")).resolves.toBeNull();
    await expect(resolve("member")).resolves.toBeNull();
  });

  it("creates a missing regular draft for a member who sends the create header", async () => {
    const { db, memberUser, project, resolve } = await fixture();
    const draftId = generateUuidv7();

    await expect(
      resolve("member", { [DRAFT_HEADER]: draftId, [DRAFT_CREATE_HEADER]: "1" }),
    ).resolves.toEqual({ id: draftId, kind: "regular", projectId: project.id });

    // No procedure reads drafts yet, so the creator is checked on the row.
    const draft = await db.select().from(drafts).where(eq(drafts.id, draftId)).get();
    expect(draft).toMatchObject({ projectId: project.id, createdBy: memberUser.id });
  });

  it("rejects a draft id that isn't a UUIDv7", async () => {
    const { resolve } = await fixture();

    await expect(
      resolve("member", { [DRAFT_HEADER]: "not-a-draft", [DRAFT_CREATE_HEADER]: "1" }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("starts one draft when two requests create the same draft at once", async () => {
    const { db, project, resolve } = await fixture();
    const draftId = generateUuidv7();
    const create = { [DRAFT_HEADER]: draftId, [DRAFT_CREATE_HEADER]: "1" };

    const scopes = await Promise.all([resolve("member", create), resolve("member", create)]);

    const expected = { id: draftId, kind: "regular", projectId: project.id };
    expect(scopes).toEqual([expected, expected]);
    const projectDrafts = await db.select().from(drafts).where(eq(drafts.projectId, project.id));
    expect(projectDrafts).toHaveLength(1);
  });

  it("rejects an anonymous caller naming a draft with 401", async () => {
    const { resolve } = await fixture();
    const draft = { [DRAFT_HEADER]: generateUuidv7(), [DRAFT_CREATE_HEADER]: "1" };

    await expect(resolve("anonymous", draft)).rejects.toMatchObject({ status: 401 });
  });

  it("rejects a caller outside the project's organization with 403", async () => {
    const { resolve } = await fixture();
    const draft = { [DRAFT_HEADER]: generateUuidv7(), [DRAFT_CREATE_HEADER]: "1" };

    await expect(resolve("outsider", draft)).rejects.toMatchObject({ status: 403 });
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

  it("resolves an existing draft for a member without the create header", async () => {
    const { project, resolve } = await fixture();
    const draftId = generateUuidv7();
    await resolve("member", { [DRAFT_HEADER]: draftId, [DRAFT_CREATE_HEADER]: "1" });

    await expect(resolve("member", { [DRAFT_HEADER]: draftId })).resolves.toEqual({
      id: draftId,
      kind: "regular",
      projectId: project.id,
    });
  });

  it("opens a development draft to its owner only", async () => {
    const { db, memberUser, outsiderUser, project, resolve } = await fixture();
    // The outsider joins the organization, so only ownership keeps them out.
    await db.insert(member).values({
      id: `membership-${outsiderUser.id}`,
      organizationId: project.organizationId,
      userId: outsiderUser.id,
      role: "member",
      createdAt: new Date(),
    });
    const draftId = generateUuidv7();
    await db.insert(drafts).values({
      id: draftId,
      projectId: project.id,
      kind: "development",
      createdBy: memberUser.id,
      createdAt: Date.now(),
    });

    await expect(resolve("member", { [DRAFT_HEADER]: draftId })).resolves.toEqual({
      id: draftId,
      kind: "development",
      projectId: project.id,
    });
    await expect(resolve("outsider", { [DRAFT_HEADER]: draftId })).rejects.toMatchObject({
      status: 403,
    });
  });

  it("rejects a draft that belongs to another project", async () => {
    const { db, memberUser, other, resolve } = await fixture();
    // The member also belongs to the other project's organization, so only the project differs.
    await db.insert(member).values({
      id: `membership-${memberUser.id}-other`,
      organizationId: other.project.organizationId,
      userId: memberUser.id,
      role: "owner",
      createdAt: new Date(),
    });
    const draftId = generateUuidv7();
    await resolve(
      "member",
      { [DRAFT_HEADER]: draftId, [DRAFT_CREATE_HEADER]: "1" },
      other.project.id,
    );

    await expect(resolve("member", { [DRAFT_HEADER]: draftId })).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      resolve("member", { [DRAFT_HEADER]: draftId, [DRAFT_CREATE_HEADER]: "1" }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
