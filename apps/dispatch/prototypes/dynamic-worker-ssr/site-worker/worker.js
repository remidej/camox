// PROTOTYPE (#522): stands in for a project's user Worker in a dispatch namespace.
import { WorkerEntrypoint } from "cloudflare:workers";

export default class extends WorkerEntrypoint {
  fetch() {
    return new Response("hello from the user Worker");
  }
  hello(name) {
    return `RPC hello, ${name}`;
  }
}
