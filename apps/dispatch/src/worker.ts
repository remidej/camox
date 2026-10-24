import { WorkerEntrypoint } from "cloudflare:workers";

import { type PreviewsApi, revisionFor } from "./previews";
import {
  type GatewayProps,
  isRevisionAssetPath,
  loadRevision,
  prewarmRevision,
  readDefinitionSet,
  type RevisionBindings,
  type RevisionToLoad,
  serveRevisionAsset,
} from "./revisions";

export interface Env extends RevisionBindings {
  /** The API's `CamoxPreviews` entrypoint, which says who sees which draft's revision. */
  API: PreviewsApi;
  PROJECT_SLUGS: KVNamespace;
  DISPATCHER: DispatchNamespace;
  /** The Camox API's origin, which only a revision's gateway lets it reach in its draft. */
  CAMOX_API_URL: string;
}

/** The request header naming the draft a Camox API request reads and writes (ADR 0011). */
const DRAFT_HEADER = "x-camox-draft";

/** What `ctx.exports` makes of dispatch's own entrypoints: a stub per set of props. */
type OwnExports = { CamoxGateway(options: { props: GatewayProps }): Fetcher };

/** Makes a revision's gateway, from dispatch's own exports. */
const gatewayOf = (ctx: ExecutionContext) => (props: GatewayProps) =>
  (ctx.exports as unknown as OwnExports).CamoxGateway({ props });

/**
 * Where a revision's outbound requests go, made per revision with its project and draft as
 * `props` (ADR 0021 amendment). A request to the Camox API is sent in the revision's draft,
 * whichever draft it names, so a revision's code reads and writes nothing else. Every other
 * request goes out as it was sent.
 */
export class CamoxGateway extends WorkerEntrypoint<Env, GatewayProps> {
  override async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).origin !== new URL(this.env.CAMOX_API_URL).origin) {
      return fetch(request);
    }
    const scoped = new Request(request);
    scoped.headers.set(DRAFT_HEADER, this.ctx.props.draft);
    return fetch(scoped);
  }
}

/**
 * What the API asks of dispatch about revisions, through its service binding. No public route
 * reaches it.
 */
export class CamoxRevisions extends WorkerEntrypoint<Env> {
  /** A revision's Definition Set, read from its build (JSON-shaped). */
  readDefinitionSet(revision: RevisionToLoad): Promise<unknown> {
    return readDefinitionSet(loadRevision(this.env, revision, gatewayOf(this.ctx)));
  }

  /**
   * Readies a revision before its draft's viewers are told of it: its client assets are served
   * from then on, and it's loaded and rendered once.
   */
  prewarm(revision: RevisionToLoad): Promise<void> {
    return prewarmRevision(this.env, revision, gatewayOf(this.ctx));
  }
}

const PROJECTS_DOMAIN = ".camox.site";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const slug = projectSlug(url.hostname);
    const uuid = slug && (await env.PROJECT_SLUGS.get(slug));
    if (!uuid) return statusPage(404, "Site not found", "There's no site at this address.");
    // A draft with code's revision (ADR 0023): its client assets, to anyone, and its renderer
    // document and runtime reads, to the members who can see the draft.
    if (isRevisionAssetPath(url.pathname)) return serveRevisionAsset(env, uuid, url.pathname);
    const revision = await revisionFor(env.API, uuid, request);
    if (revision) {
      return loadRevision(env, revision, gatewayOf(ctx)).getEntrypoint().fetch(request);
    }
    try {
      // The user Worker is named after the project's UUID. Cloudflare may report it missing from
      // either call, so both sit in the try.
      return await env.DISPATCHER.get(uuid).fetch(request);
    } catch (error) {
      // "Worker not found" is what the dispatch namespace throws for a user Worker it doesn't have.
      if (!(error instanceof Error && error.message.startsWith("Worker not found"))) throw error;
      // The project exists, but its first release hasn't deployed its Worker yet.
      return statusPage(503, "This site is being set up", "Check back in a few minutes.");
    }
  },
} satisfies ExportedHandler<Env>;

/**
 * What precedes camox.site in a hostname. Slugs are one label, the depth Universal SSL covers, so
 * a deeper subdomain finds no slug. Mirrored in apps/api/src/domains/auth/studio-hosts.ts, which
 * tells the studio's sign-in a project's host: keep the two in sync.
 */
function projectSlug(hostname: string) {
  return hostname.endsWith(PROJECTS_DOMAIN) ? hostname.slice(0, -PROJECTS_DOMAIN.length) : "";
}

function statusPage(status: number, title: string, message: string) {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
</head>
<body style="font-family: system-ui, sans-serif; display: grid; place-items: center; min-height: 90vh; margin: 0; color: #222">
<main style="text-align: center">
<h1>${title}</h1>
<p>${message}</p>
</main>
</body>
</html>
`;
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
