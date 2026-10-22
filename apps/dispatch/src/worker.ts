export interface Env {
  PROJECT_SLUGS: KVNamespace;
  DISPATCHER: DispatchNamespace;
}

const PROJECTS_DOMAIN = ".camox.site";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const slug = projectSlug(new URL(request.url).hostname);
    const uuid = slug && (await env.PROJECT_SLUGS.get(slug));
    if (!uuid) return statusPage(404, "Site not found", "There's no site at this address.");
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
