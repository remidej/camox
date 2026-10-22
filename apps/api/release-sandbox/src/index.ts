// The release sandbox Worker: the Container sandboxes each step of a release runs in
// (src/domains/releases/README.md). The API's release Workflow binds their Durable Object by
// script name, so only this Worker carries the Container image.
export { CiSandbox } from "@cloudflare/ci/worker";

export default {
  fetch: () => new Response("Not found", { status: 404 }),
};
