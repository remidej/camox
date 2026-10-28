import { call } from "@orpc/server";
import { describe, expect, it } from "vite-plus/test";

import { createProjectFixture, createRpcContext } from "../../../test/fixtures";
import { router } from "../../router";

async function fixture() {
  const base = await createProjectFixture(`experimental-features-${crypto.randomUUID()}`);
  const as = (user: typeof base.memberUser) => ({
    context: createRpcContext(base.db, user, {}),
  });
  const setExperimentalFeatures = (experimentalFeatures: boolean, user = base.memberUser) =>
    call(
      router.projects.updateExperimentalFeatures,
      { id: base.project.id, experimentalFeatures },
      as(user),
    );
  const memberRead = () => call(router.projects.get, { id: base.project.id }, as(base.memberUser));
  return { ...base, setExperimentalFeatures, memberRead };
}

describe("Experimental features", () => {
  it("are off for a new project, and a member switches them on and off", async () => {
    const f = await fixture();
    expect((await f.memberRead()).experimentalFeatures).toBe(false);

    await f.setExperimentalFeatures(true);
    expect((await f.memberRead()).experimentalFeatures).toBe(true);

    await f.setExperimentalFeatures(false);
    expect((await f.memberRead()).experimentalFeatures).toBe(false);
  });

  it("forbids someone outside the project's organization", async () => {
    const f = await fixture();
    await expect(f.setExperimentalFeatures(true, f.outsiderUser)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect((await f.memberRead()).experimentalFeatures).toBe(false);
  });
});
