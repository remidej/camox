import { WorkerEntrypoint } from "cloudflare:workers";

import { type LiveScriptApi, liveScriptFor } from "./live-script";
import { type PreviewsApi, revisionFor } from "./previews";
import {
  type GatewayProps,
  isMissingBuild,
  isRevisionAssetPath,
  isSdkBundlePath,
  loadRevision,
  type PreparedRevision,
  type PrepareTimings,
  prepareRevision,
  readDefinitionSet,
  type RevisionBindings,
  type RevisionToLoad,
  serveRevisionAsset,
  serveSdkBundleFile,
} from "./revisions";

export interface Env extends RevisionBindings {
  /**
   * The API's `CamoxPreviews` entrypoint, which says who sees which draft's revision, and which
   * user Worker serves a website.
   */
  API: PreviewsApi & LiveScriptApi;
  /**
   * The hosts dispatch serves: each Project Slug and each Custom Domain maps to its Project ID. A
   * slug's entry names its project's Custom Domain, if any, in its metadata (`SlugMetadata`).
   */
  PROJECT_SLUGS: KVNamespace;
  DISPATCHER: DispatchNamespace;
  /** The Camox API's origin, which only a revision's gateway lets it reach in its draft. */
  CAMOX_API_URL: string;
}

/** The request header naming the draft a Camox API request reads and writes (ADR 0011). */
const DRAFT_HEADER = "x-camox-draft";

declare global {
  namespace Cloudflare {
    /** Dispatch's main module, which types `ctx.exports`: a stub per entrypoint and props. */
    interface GlobalProps {
      mainModule: typeof import("./worker");
    }
  }
}

/** Makes a revision's gateway, from dispatch's own exports. */
const gatewayOf = (ctx: ExecutionContext) => (props: GatewayProps) =>
  ctx.exports.CamoxGateway({ props });

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
   * Readies a revision before its draft's viewers are told of it, reading its build once, from
   * `archive` when the API sends it, or else from R2: its client assets are served from then on,
   * and it's loaded and rendered once. Returns its Definition Set (JSON-shaped), with what each
   * part took.
   */
  prepare(revision: RevisionToLoad, archive?: Uint8Array): Promise<PreparedRevision> {
    return prepareRevision(this.env, revision, gatewayOf(this.ctx), archive);
  }

  /**
   * `prepare`, for an API deployed before it, which dispatch's deploy precedes: it reads the
   * Definition Set with `readDefinitionSet`.
   */
  async prewarm(revision: RevisionToLoad): Promise<PrepareTimings> {
    const { definitionSet: _, ...timings } = await this.prepare(revision);
    return timings;
  }
}

const PROJECTS_DOMAIN = ".camox.site";

/** What a Project Slug's KV entry holds beside its Project ID (ADR 0028). */
type SlugMetadata = { customDomain?: string } | null;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const host = await resolveHost(env, url.hostname);
    if (!host) return statusPage(404, "Site not found", "There's no site at this address.");
    // A project with a Custom Domain is served there only, so its website names one origin.
    if (host.customDomain) {
      const target = new URL(url);
      target.hostname = host.customDomain;
      return Response.redirect(target.toString(), 301);
    }
    const { uuid } = host;
    // A draft with code's revision (ADR 0023): its client assets, to anyone, and its renderer
    // document and runtime reads, to the members who can see the draft.
    if (isRevisionAssetPath(url.pathname)) return serveRevisionAsset(env, uuid, url.pathname);
    // The SDK Bundles revisions name (ADR 0029): the same for every project, to anyone. One no
    // revision was prepared with, such as an Upgrade's release's, is among Live's static assets.
    const sdkBundlePath = isSdkBundlePath(url.pathname);
    if (sdkBundlePath) {
      const served = await serveSdkBundleFile(env, url.pathname);
      if (served) return served;
    }
    const revision = sdkBundlePath ? null : await revisionFor(env.API, uuid, request);
    if (revision) {
      try {
        return await loadRevision(env, revision, gatewayOf(ctx)).getEntrypoint().fetch(request);
      } catch (error) {
        // A revision whose build is gone shows Live's code rather than fail.
        if (!isMissingBuild(error)) throw error;
        console.warn("A draft's previewed revision has no build: Live's code answers", error);
      }
    }
    // A publish's own Worker, or the one named after the project's UUID, which releases deploy.
    const script = await liveScriptFor(env.API, uuid);
    if (script !== uuid) {
      // A request with a body keeps it for the release's Worker, should this one be gone.
      const published = await dispatchTo(env, script, request.body ? request.clone() : request);
      if (published) return published;
      // A publish's Worker deleted since the API answered: its release's Worker serves.
      console.warn(`The publish's Worker ${script} is gone: the project's Worker answers`);
    }
    return (
      (await dispatchTo(env, uuid, request)) ??
      // The project exists, but its first release hasn't deployed its Worker yet.
      statusPage(503, "This site is being set up", "Check back in a few minutes.")
    );
  },
} satisfies ExportedHandler<Env>;

/**
 * The project a hostname serves: a Custom Domain's, or a `camox.site` slug's, with the Custom
 * Domain that slug redirects to, if any. Null for any other host. Mirrored in
 * apps/api/src/domains/auth/studio-hosts.ts, which tells the studio's sign-in the hosts it may sign
 * in on: keep the two in sync.
 */
async function resolveHost(
  env: Env,
  hostname: string,
): Promise<{ uuid: string; customDomain?: string } | null> {
  if (!hostname.endsWith(PROJECTS_DOMAIN)) {
    const uuid = await env.PROJECT_SLUGS.get(hostname);
    return uuid ? { uuid } : null;
  }
  const slug = projectSlug(hostname);
  // Slugs are one label, so a deeper subdomain names none, nor a Custom Domain's entry.
  if (!slug || slug.includes(".")) return null;
  const { value: uuid, metadata } = await env.PROJECT_SLUGS.getWithMetadata<SlugMetadata>(slug);
  if (!uuid) return null;
  return { uuid, customDomain: metadata?.customDomain };
}

/** The user Worker `script`'s answer to `request`, or null when there's no such Worker. */
async function dispatchTo(env: Env, script: string, request: Request) {
  try {
    // Cloudflare may report it missing from either call, so both sit in the try.
    return await env.DISPATCHER.get(script).fetch(request);
  } catch (error) {
    // "Worker not found" is what the dispatch namespace throws for a user Worker it doesn't have.
    if (!(error instanceof Error && error.message.startsWith("Worker not found"))) throw error;
    return null;
  }
}

/**
 * What precedes camox.site in a hostname. Slugs are one label, the depth Universal SSL covers, so
 * a deeper subdomain finds no slug.
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
