// The sandbox Worker running the agent's code mode scripts (ADR 0018): a Durable Object whose
// only job is running a script's QuickJS VM. The API binds it by script name, so a script that
// computes holds up this Worker's isolate rather than the thread's own Durable Object. Tools
// keep running in the thread, which the VM calls back over Workers RPC.
export { CodemodeSandboxDurableObject as CodemodeSandbox } from "@earendil-works/pi-codemode/cloudflare";

export default {
  fetch: () => new Response("Not found", { status: 404 }),
};
