import { DRAFT_CREATE_HEADER, DRAFT_HEADER, LOOK_TOKEN_HEADER } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { call } from "@orpc/server";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { callSeedingLive, createProjectFixture, createRpcContext } from "../../../test/fixtures";
import { router } from "../../router";
import type { Bindings } from "../../types";
import { signLookToken } from "./look-token";

// ADR 0032: a look token lets the browser `look` drives read one draft's content, without a
// session, and nothing else.

const bindings = env as unknown as Bindings;

/** A project whose Live has a home page, and a draft that adds a pricing page. */
async function fixture() {
  const base = await createProjectFixture(`look-token-${crypto.randomUUID()}`);
  const { db, project, memberUser, layout } = base;
  const projectId = project.id;
  const member = (headers: Record<string, string> = {}) => ({
    context: createRpcContext(db, memberUser, headers),
  });
  await callSeedingLive(
    router.pages.create,
    { projectId, pathSegment: "", layoutId: layout.layoutId },
    member(),
  );
  const openDraft = async (pathSegment: string) => {
    const id = generateUuidv7();
    await call(
      router.pages.create,
      { projectId, pathSegment, layoutId: layout.layoutId },
      member({ [DRAFT_HEADER]: id, [DRAFT_CREATE_HEADER]: "1" }),
    );
    return id;
  };
  const draftId = await openDraft("pricing");
  /** A request with no session, carrying `token` and naming `draft`, if any. */
  const browser = (token: string, draft?: string) => ({
    context: createRpcContext(db, null, {
      [LOOK_TOKEN_HEADER]: token,
      ...(draft && { [DRAFT_HEADER]: draft }),
    }),
  });
  const pricing = (token: string, draft = draftId) =>
    call(
      router.pages.getByPath,
      { projectUuid: project.uuid, path: "/pricing" },
      browser(token, draft),
    );
  return { ...base, projectId, draftId, openDraft, browser, pricing };
}

const lookToken = (projectId: number, draftId: string) =>
  signLookToken(bindings, { projectId, draftId });

afterEach(() => {
  vi.useRealTimers();
});

describe("a look token", () => {
  it("reads its draft's content without a session", async () => {
    const f = await fixture();
    const { page } = await f.pricing(await lookToken(f.projectId, f.draftId));
    expect(page.fullPath).toBe("/pricing");
  });

  it("reads its draft's pages and locales, as a page's render does", async () => {
    const f = await fixture();
    const token = await lookToken(f.projectId, f.draftId);
    const { pages } = await call(
      router.pages.listBySlug,
      { projectUuid: f.project.uuid },
      f.browser(token, f.draftId),
    );
    expect(pages.map((page) => page.fullPath).sort()).toEqual(["/", "/pricing"]);
    const locales = await call(
      router.locales.list,
      { projectUuid: f.project.uuid },
      f.browser(token, f.draftId),
    );
    expect(locales).toHaveLength(1);
  });

  it("is needed to read a draft without a session", async () => {
    const f = await fixture();
    await expect(f.pricing("")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("is refused once it has expired", async () => {
    const f = await fixture();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() - 10 * 60_000);
    const token = await lookToken(f.projectId, f.draftId);
    vi.useRealTimers();
    await expect(f.pricing(token)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("is refused when it isn't one the API signed", async () => {
    const f = await fixture();
    const token = await lookToken(f.projectId, f.draftId);
    const [payload] = token.split(".");
    const forged = `${payload}.${btoa("not the signature").replaceAll("=", "")}`;
    await expect(f.pricing(forged)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("reads no other draft", async () => {
    const f = await fixture();
    const other = await f.openDraft("about");
    const token = await lookToken(f.projectId, f.draftId);
    await expect(
      call(
        router.pages.getByPath,
        { projectUuid: f.project.uuid, path: "/about" },
        f.browser(token, other),
      ),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("reads its draft in its own project only", async () => {
    const f = await fixture();
    const other = await createProjectFixture(`look-token-other-${crypto.randomUUID()}`);
    const token = await lookToken(other.project.id, f.draftId);
    await expect(f.pricing(token)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // Every content write needs a signed-in member before content access runs, so that's what
  // refuses the token.
  it("writes nothing to its draft", async () => {
    const f = await fixture();
    const token = await lookToken(f.projectId, f.draftId);
    await expect(
      call(
        router.pages.create,
        { projectId: f.projectId, pathSegment: "contact", layoutId: f.layout.layoutId },
        f.browser(token, f.draftId),
      ),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("reads none of Live's private data", async () => {
    const f = await fixture();
    const token = await lookToken(f.projectId, f.draftId);
    // Reading a page by its project's internal id is for members only.
    for (const draft of [undefined, f.draftId]) {
      await expect(
        call(router.pages.get, { projectId: f.projectId, path: "/" }, f.browser(token, draft)),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
  });
});
