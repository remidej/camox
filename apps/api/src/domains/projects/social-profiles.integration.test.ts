import { DRAFT_CREATE_HEADER, DRAFT_HEADER } from "@camox/api-contract/drafts";
import { generateUuidv7 } from "@camox/api-contract/ids";
import { call } from "@orpc/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { callSeedingLive, createProjectFixture, createRpcContext } from "../../../test/fixtures";
import { router } from "../../router";

async function fixture() {
  const base = await createProjectFixture(`social-profiles-${crypto.randomUUID()}`);
  const as = (user: typeof base.memberUser | null, headers: Record<string, string> = {}) => ({
    context: createRpcContext(base.db, user, headers),
  });
  const setProfiles = (socialProfiles: string[], user = base.memberUser) =>
    call(router.projects.updateSocialProfiles, { id: base.project.id, socialProfiles }, as(user));
  const memberRead = () => call(router.projects.get, { id: base.project.id }, as(base.memberUser));
  return { ...base, as, setProfiles, memberRead };
}

const github = "https://github.com/acme";
const linkedIn = "https://www.linkedin.com/company/acme";
const x = "https://x.com/acme";

describe("Social profiles", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a member adds, reorders and removes profiles, kept in their order", async () => {
    const f = await fixture();
    expect((await f.memberRead()).socialProfiles).toEqual([]);

    await f.setProfiles([github, linkedIn, x]);
    expect((await f.memberRead()).socialProfiles).toEqual([github, linkedIn, x]);

    await f.setProfiles([x, github, linkedIn]);
    expect((await f.memberRead()).socialProfiles).toEqual([x, github, linkedIn]);

    await f.setProfiles([x, linkedIn]);
    expect((await f.memberRead()).socialProfiles).toEqual([x, linkedIn]);

    await f.setProfiles([]);
    expect((await f.memberRead()).socialProfiles).toEqual([]);
  });

  it("refuses URLs that aren't https, and keeps the profiles as they were", async () => {
    const f = await fixture();
    await f.setProfiles([github]);
    for (const url of [
      "http://github.com/acme",
      "github.com/acme",
      "/acme",
      "",
      "ftp://github.com/acme",
      "javascript:alert(1)",
      "https://",
      "https:github.com/acme",
      " https://github.com/acme",
    ]) {
      await expect(f.setProfiles([linkedIn, url]), url).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    }
    expect((await f.memberRead()).socialProfiles).toEqual([github]);
  });

  it("changing the profiles bumps the project's updated time", async () => {
    const f = await fixture();
    const before = (await f.memberRead()).updatedAt;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(before + 60_000);
    await f.setProfiles([github]);
    expect((await f.memberRead()).updatedAt).toBe(before + 60_000);
  });

  it("forbids someone outside the project's organization", async () => {
    const f = await fixture();
    await f.setProfiles([github]);
    await expect(f.setProfiles([x], f.outsiderUser)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(f.setProfiles([], f.outsiderUser)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await f.memberRead()).socialProfiles).toEqual([github]);
  });

  it("the public page data carries the profiles, the same in every draft as on Live", async () => {
    const f = await fixture();
    await callSeedingLive(
      router.pages.create,
      { projectId: f.project.id, pathSegment: "", layoutId: f.layout.layoutId },
      f.as(f.memberUser),
    );
    // A draft that holds its own edit, started before the profiles were set.
    const draftId = generateUuidv7();
    await call(
      router.pages.create,
      { projectId: f.project.id, pathSegment: "pricing", layoutId: f.layout.layoutId },
      f.as(f.memberUser, { [DRAFT_HEADER]: draftId, [DRAFT_CREATE_HEADER]: "1" }),
    );
    await f.setProfiles([linkedIn, github]);

    const input = { projectUuid: f.project.uuid, path: "/" };
    const reads = [
      ["Live, as a visitor", f.as(null)],
      ["a draft, as a member", f.as(f.memberUser, { [DRAFT_HEADER]: draftId })],
    ] as const;
    for (const [reader, options] of reads) {
      for (const read of [router.pages.getByPath, router.pages.getStructure]) {
        const { project } = await call(read, input, options);
        expect(project.socialProfiles, reader).toEqual([linkedIn, github]);
      }
      const { project } = await call(
        router.layouts.get,
        { projectUuid: f.project.uuid, layoutId: f.layout.layoutId },
        options,
      );
      expect(project.socialProfiles, reader).toEqual([linkedIn, github]);
    }
  });
});
