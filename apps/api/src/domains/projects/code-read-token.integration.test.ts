import { call } from "@orpc/server";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";

import { FAKE_GIT_HOST } from "../../../test/fake-git-server";
import { createProjectFixture, createRpcContext } from "../../../test/fixtures";
import { router } from "../../router";
import { projects } from "../../schema";

// A member clones a flagged project's code with plain Git, authenticated by short-lived read
// tokens the API mints for its repo (ADR 0026).

type GitFakes = {
  commit(repo: string, files: Record<string, string>, message: string): Promise<string>;
};

const fakes = (env as unknown as { RELEASE_FAKES: GitFakes }).RELEASE_FAKES;

async function fixture({ flagged }: { flagged: boolean }) {
  const f = await createProjectFixture(`code-read-token-${crypto.randomUUID()}`);
  await fakes.commit(f.project.uuid, { "package.json": "{}\n" }, "Create the website");
  if (flagged) {
    await f.db
      .update(projects)
      .set({ codeOutsideCamox: true })
      .where(eq(projects.id, f.project.id));
  }
  const readToken = (user: typeof f.memberUser | null) =>
    call(
      router.projects.createCodeReadToken,
      { projectUuid: f.project.uuid },
      { context: createRpcContext(f.db, user) },
    );
  return { ...f, readToken };
}

describe("A project's code read token", () => {
  it("is given to a member of a flagged project's organization, with its repo's Git remote", async () => {
    const f = await fixture({ flagged: true });

    const access = await f.readToken(f.memberUser);

    expect(access).toMatchObject({
      remote: `https://${FAKE_GIT_HOST}/git/projects/${f.project.uuid}.git`,
      projectSlug: f.project.slug,
    });
    // Artifacts mints `<secret>?expires=<unix seconds>`; Git's password is the secret alone.
    expect(access.token).toBe("artifacts-read-token");
  });

  it("is refused, saying so, on a project without the flag", async () => {
    const f = await fixture({ flagged: false });

    await expect(f.readToken(f.memberUser)).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringMatching(/can't be worked on outside Camox/),
    });
  });

  it("is refused to someone outside the project's organization", async () => {
    const f = await fixture({ flagged: true });

    await expect(f.readToken(f.outsiderUser)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("is refused to a visitor", async () => {
    const f = await fixture({ flagged: true });

    await expect(f.readToken(null)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
