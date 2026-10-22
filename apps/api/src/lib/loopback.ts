/**
 * Whether `hostname`, as `URL` reports it, names this computer: `localhost`, a `*.localhost`
 * worktree hostname, or a loopback IP.
 */
export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "[::1]") return true;
  return /^127(?:\.\d{1,3}){3}$/.test(host);
}
