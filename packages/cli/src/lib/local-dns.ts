import dns from "node:dns";
import { syncBuiltinESMExports } from "node:module";

const selectedHosts = new Set<string>();
let installed = false;

/** Resolve explicitly selected local backends without depending on OS wildcard DNS. */
export function installLocalhostDns(hostname: string): void {
  if (!hostname.endsWith(".localhost")) return;
  selectedHosts.add(hostname);
  if (installed) return;
  installed = true;

  // Proxies retain overloads and Node's custom promisify metadata. Delegating to
  // lookup preserves options, callback timing, and unrelated DNS behavior.
  const handler: ProxyHandler<typeof dns.lookup | typeof dns.promises.lookup> = {
    apply(target, receiver, args) {
      if (selectedHosts.has(args[0])) args[0] = "127.0.0.1";
      return Reflect.apply(target, receiver, args);
    },
  };
  dns.lookup = new Proxy<typeof dns.lookup>(dns.lookup, handler);
  dns.promises.lookup = new Proxy<typeof dns.promises.lookup>(dns.promises.lookup, handler);
  syncBuiltinESMExports();
}
