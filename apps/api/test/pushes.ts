import { introspectWorkflowInstance } from "cloudflare:test";
import { env } from "cloudflare:workers";

import type { FakeFile, PushEvent } from "./fake-git-server";

// Moves a project's `main` the way a push to its repo does: the fake Git server records each push
// to `main` as the event Cloudflare Artifacts sends, and delivering it starts the release Workflow
// as the event's trigger does (wrangler.jsonc).

type GitFakes = {
  commit(repo: string, files: Record<string, FakeFile>, message: string): Promise<string>;
  takePushEvents(repo: string): Promise<PushEvent[]>;
};

const fakes = (env as unknown as { RELEASE_FAKES: GitFakes }).RELEASE_FAKES;

/** Delivers the events of the pushes to a repo's `main` since the last delivery, in order. */
export async function deliverPushes(repo: string) {
  for (const event of await fakes.takePushEvents(repo)) {
    const id = crypto.randomUUID();
    await using instance = await introspectWorkflowInstance(env.RELEASE_WORKFLOW, id);
    await instance.modify(async (m) => m.disableRetryDelays());
    await env.RELEASE_WORKFLOW.create({ id, params: event });
    await instance.waitForStatus("complete");
  }
}

/**
 * Pushes `files` as the whole tree of a project's `main`, from outside Camox, and delivers the
 * push. Returns the commit.
 */
export async function pushToMain(repo: string, files: Record<string, FakeFile>, message = "Push") {
  const commit = await fakes.commit(repo, files, message);
  await deliverPushes(repo);
  return commit;
}
