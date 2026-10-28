/**
 * The Git config entries that make `camox git-credential` the credential helper for a remote's
 * host, written in a clone's own config only. An empty `helper` first drops every helper set
 * elsewhere for that host, such as a keychain that would keep expired read tokens. Git sends the
 * path, which names the project.
 */
export function credentialHelperConfig(remote: string): [string, string][] {
  const { origin } = new URL(remote);
  return [
    [`credential.${origin}.helper`, ""],
    [`credential.${origin}.helper`, `!${helperCommand()}`],
    [`credential.${origin}.useHttpPath`, "true"],
  ];
}

/** This CLI, as a shell runs it: with this Node.js, so it works without `camox` on the PATH. */
function helperCommand() {
  const quote = (arg: string) => `'${arg.replaceAll("'", `'\\''`)}'`;
  return `${quote(process.execPath)} ${quote(process.argv[1]!)} git-credential`;
}

/** Parses what Git writes to a credential helper: `key=value` lines up to a blank one. */
export function parseCredentialRequest(input: string) {
  const request: Record<string, string> = {};
  for (const line of input.split("\n")) {
    if (line === "") break;
    const at = line.indexOf("=");
    if (at > 0) request[line.slice(0, at)] = line.slice(at + 1);
  }
  return request;
}

/** The Project ID a repo's remote path names: `git/<namespace>/<Project ID>.git`. */
export function projectIdOfPath(path: string | undefined) {
  return path?.match(/([^/]+?)(?:\.git)?\/?$/)?.[1];
}
