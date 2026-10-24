// The release sandbox Worker: the Container sandboxes each step of a release runs in
// (src/domains/releases/README.md), and those each draft with code builds its revisions in
// (src/domains/revisions). The API binds their Durable Objects by script name, so only this
// Worker carries the Container image.
import { Sandbox } from "@cloudflare/sandbox";

export { CiSandbox } from "@cloudflare/ci/worker";

/**
 * A draft with code's sandbox, named by the draft's ID. The API drives it with `getSandbox`,
 * which also tells it how long to stay up idle.
 */
export class RevisionSandbox extends Sandbox {}

/**
 * The sandbox a publish with code uploads and promotes the project's Worker in, with wrangler,
 * named by the project's Project ID. Its image has wrangler and nothing to build with.
 */
export class PublishSandbox extends Sandbox {}

export default {
  fetch: () => new Response("Not found", { status: 404 }),
};
