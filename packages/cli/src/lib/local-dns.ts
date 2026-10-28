import dns from "node:dns";
import { syncBuiltinESMExports } from "node:module";

const selectedHosts = new Set<string>();
let installed = false;

/** `lookup`, resolving the selected hosts to 127.0.0.1. */
const toSelectedHosts = <F extends (hostname: string, ...rest: never[]) => unknown>(lookup: F) =>
  new Proxy(lookup, {
    apply(target, receiver, args: Parameters<F>) {
      if (selectedHosts.has(args[0])) args[0] = "127.0.0.1";
      return target.apply(receiver, args);
    },
  });

/** Resolve explicitly selected local backends without depending on OS wildcard DNS. */
export function installLocalhostDns(hostname: string): void {
  if (!hostname.endsWith(".localhost")) return;
  selectedHosts.add(hostname);
  if (installed) return;
  installed = true;

  // Proxies retain overloads and Node's custom promisify metadata. Delegating to
  // lookup preserves options, callback timing, and unrelated DNS behavior.
  dns.lookup = toSelectedHosts(dns.lookup);
  dns.promises.lookup = toSelectedHosts(dns.promises.lookup);
  syncBuiltinESMExports();
}
