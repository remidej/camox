import { artifactFontLinks, artifactShellHash, artifactUrlDocument } from "../../core/lib/artifact";
import type { RuntimeOptions } from "./runtime";
import { ARTIFACTS_PATH_PREFIX } from "./runtimeRoutes";

/** The website's artifact shell: its font links, and the hash that names them with the runtime. */
export interface ArtifactShell {
  fontLinks: string;
  hash: string;
}

const shells = new WeakMap<RuntimeOptions, Promise<ArtifactShell>>();

/**
 * The website's artifact shell, computed once per runtime: its font links come from the build's
 * document definition, so they never change while it runs.
 */
export function readArtifactShell(options: RuntimeOptions): Promise<ArtifactShell> {
  let shell = shells.get(options);
  if (!shell) {
    shell = (async () => {
      const fontLinks = artifactFontLinks(await options.getDocument?.());
      return { fontLinks, hash: await artifactShellHash(fontLinks) };
    })();
    shell.catch(() => shells.delete(options));
    shells.set(options, shell);
  }
  return shell;
}

/** Whether a path inside the runtime (base path removed) names an artifact's document. */
export function isArtifactPath(pathname: string) {
  return pathname.startsWith(ARTIFACTS_PATH_PREFIX);
}

const YEAR = 365 * 24 * 60 * 60;

/**
 * An artifact's document, served at `/_camox/artifacts/<shellHash>/<sourceHash>`: the source the
 * API stores under its hash, inside the website's current shell. It's the same for every visitor,
 * so cookies are ignored. It keeps an opaque origin even when opened top-level, and only a
 * document whose shell matches its URL is cached: one from a previous release still loads.
 */
export async function createArtifactDocumentResponse(
  pathname: string,
  options: RuntimeOptions,
): Promise<Response> {
  const [shellHash, sourceHash, ...rest] = pathname.slice(ARTIFACTS_PATH_PREFIX.length).split("/");
  const { apiUrl, projectUuid } = options;
  if (!apiUrl || !projectUuid) {
    return Response.json({ message: "Camox artifacts are not configured." }, { status: 500 });
  }
  if (!shellHash || !sourceHash || rest.length) return notFound();

  const [shell, stored] = await Promise.all([
    readArtifactShell(options),
    fetch(
      `${apiUrl}/artifact-sources/${encodeURIComponent(projectUuid)}/${encodeURIComponent(sourceHash)}`,
    ),
  ]);
  if (stored.status === 404) return notFound();
  if (!stored.ok) {
    return new Response("Artifact source unavailable", {
      status: 502,
      headers: { "Cache-Control": "no-store" },
    });
  }

  return new Response(artifactUrlDocument(await stored.text(), shell.fontLinks), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": shellHash === shell.hash ? `public, max-age=${YEAR}, immutable` : "no-store",
      "Content-Security-Policy": "sandbox allow-scripts",
      "X-Robots-Tag": "noindex",
    },
  });
}

function notFound() {
  return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
}
