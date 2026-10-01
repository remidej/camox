import { installLocalhostDns } from "../packages/cli/src/lib/local-dns.ts";

// Only the coordinated checkout's hostname is special. Preserve Node's lookup
// options, callback timing, errors, and unrelated DNS behavior by delegating.
installLocalhostDns(process.env.CAMOX_DEV_HOSTNAME ?? "");
