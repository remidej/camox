// The part of the Cloudflare API the Workflows call with Camox's token: the user Workers of the
// `production` Workers for Platforms dispatch namespace, their uploads with their static assets,
// and their deletion, one by one or by tag. It answers as Cloudflare does, with a JSON envelope,
// and keeps the user Workers it was given, each a project's, by name: a project's names start
// with its Project ID, so the calls of a test's project are its own.
// https://developers.cloudflare.com/api/resources/workers_for_platforms/subresources/dispatch/subresources/namespaces/subresources/scripts/
// https://developers.cloudflare.com/workers/static-assets/direct-upload/

/** The Cloudflare API token and account the API is given in tests (vite.config.ts). */
const CLOUDFLARE_API_TOKEN = "test-cloudflare-token";
const CLOUDFLARE_ACCOUNT_ID = "0123456789abcdef0123456789abcdef";

/** A user Worker, as its upload made it. */
export type FakeUserWorker = {
  name: string;
  /** The upload's metadata part, as sent. */
  metadata: Record<string, unknown> | null;
  /** Its modules' content types and text, by name. */
  modules: Record<string, { type: string; text: string }>;
  /** Its static assets' content types and text, by path. */
  assets: Record<string, { contentType: string; text: string }>;
  tags: string[];
};

/** A call to the fake API, as the tests read them. */
export type CloudflareCall = { call: string; order: number };

const userWorkers = new Map<string, FakeUserWorker>();
const failingDeletions = new Set<string>();
/** Upload sessions' tokens → the user Worker and its manifest's files left to upload. */
const assetSessions = new Map<
  string,
  { script: string; manifest: Record<string, { hash: string }>; left: Set<string> }
>();
/** Completion tokens → the assets they attach, by path. */
const completedAssets = new Map<string, FakeUserWorker["assets"]>();
/** Every asset ever uploaded, by hash. */
const uploadedAssets = new Map<string, { contentType: string; text: string }>();
const calls = new Map<string, CloudflareCall[]>();
const failing: { project: string; pattern: string; times: number; landing: boolean }[] = [];
let held: { project: string; pattern: string }[] = [];
let callsCount = 0;

/** Counts every call, so tests can order calls among the fakes' other records. */
export const order = () => callsCount++;

const envelope = (status: number, result: unknown = null, errors: unknown[] = []) =>
  Response.json({ success: status < 400, errors, messages: [], result }, { status });
const unauthorized = () => envelope(403, null, [{ code: 10000, message: "Authentication error" }]);

const SCRIPTS =
  /^\/client\/v4\/accounts\/([^/]+)\/workers\/dispatch\/namespaces\/([^/]+)\/scripts$/;
const SCRIPT =
  /^\/client\/v4\/accounts\/([^/]+)\/workers\/dispatch\/namespaces\/([^/]+)\/scripts\/([^/]+)(\/assets-upload-session)?$/;
const ASSETS_UPLOAD = /^\/client\/v4\/accounts\/([^/]+)\/workers\/assets\/upload$/;

/** The project a user Worker belongs to: the Project ID its name starts with. */
const projectOf = (name: string) => name.slice(0, 36);

/** Records a call of `project`'s, then fails or holds it as its test asked. */
async function intercept(project: string, call: string, answer: () => Promise<Response>) {
  const recorded = calls.get(project) ?? [];
  recorded.push({ call, order: order() });
  calls.set(project, recorded);
  // Polled: a promise resolved from the request letting go wouldn't wake this one.
  while (held.some((hold) => hold.project === project && call.includes(hold.pattern))) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const failure = failing.find(
    (fail) => fail.project === project && fail.times > 0 && call.includes(fail.pattern),
  );
  if (!failure) return answer();
  failure.times -= 1;
  if (failure.landing) await answer();
  return envelope(500, null, [{ code: 10013, message: "An unknown error has occurred" }]);
}

const text = async (part: string | File) => (typeof part === "string" ? part : await part.text());

async function uploadScript(name: string, request: Request) {
  const form = await request.formData();
  const metadataPart = form.get("metadata");
  if (!metadataPart) return envelope(400, null, [{ code: 10021, message: "Missing metadata" }]);
  const metadata = JSON.parse(await text(metadataPart)) as Record<string, unknown> & {
    main_module?: string;
    tags?: string[];
    assets?: { jwt?: string };
  };
  const modules: FakeUserWorker["modules"] = {};
  for (const [partName, part] of form) {
    if (partName === "metadata" || typeof part === "string") continue;
    modules[partName] = { type: part.type, text: await part.text() };
  }
  if (!metadata.main_module || !modules[metadata.main_module]) {
    return envelope(400, null, [{ code: 10021, message: "No such module: main_module" }]);
  }
  let assets: FakeUserWorker["assets"] = {};
  if (metadata.assets?.jwt) {
    const completed = completedAssets.get(metadata.assets.jwt);
    if (!completed) return envelope(400, null, [{ code: 10200, message: "Invalid assets JWT" }]);
    assets = completed;
  }
  userWorkers.set(name, { name, metadata, modules, assets, tags: metadata.tags ?? [] });
  return envelope(200, { id: name });
}

function startAssetsSession(name: string, manifest: Record<string, { hash: string }>) {
  const jwt = `assets-session-${crypto.randomUUID()}`;
  const left = new Set(
    Object.values(manifest)
      .map(({ hash }) => hash)
      .filter((hash) => !uploadedAssets.has(hash)),
  );
  assetSessions.set(jwt, { script: name, manifest, left });
  if (left.size === 0) completeAssets(jwt);
  // Two files a bucket, so a session takes more than one upload.
  const hashes = [...left];
  const buckets = [];
  for (let at = 0; at < hashes.length; at += 2) buckets.push(hashes.slice(at, at + 2));
  return envelope(200, { jwt, buckets });
}

function completeAssets(jwt: string) {
  const session = assetSessions.get(jwt)!;
  completedAssets.set(
    jwt,
    Object.fromEntries(
      Object.entries(session.manifest).map(([path, { hash }]) => [path, uploadedAssets.get(hash)!]),
    ),
  );
  return jwt;
}

async function uploadAssets(request: Request) {
  const jwt = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const session = assetSessions.get(jwt);
  if (!session) return unauthorized();
  if (new URL(request.url).searchParams.get("base64") !== "true") {
    return envelope(400, null, [{ code: 10201, message: "Uploads must be base64" }]);
  }
  return intercept(projectOf(session.script), `POST assets/upload ${session.script}`, async () => {
    const form = await request.formData();
    for (const [hash, part] of form) {
      if (typeof part === "string") continue;
      const bytes = Uint8Array.from(atob(await part.text()), (char) => char.charCodeAt(0));
      uploadedAssets.set(hash, { contentType: part.type, text: new TextDecoder().decode(bytes) });
      session.left.delete(hash);
    }
    if (session.left.size > 0) return envelope(200, {});
    return envelope(201, { jwt: completeAssets(jwt) });
  });
}

/** Answers a request to `api.cloudflare.com`. */
export async function serveCloudflareApi(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const upload = ASSETS_UPLOAD.exec(url.pathname);
  if (upload && request.method === "POST") {
    return upload[1] === CLOUDFLARE_ACCOUNT_ID ? uploadAssets(request) : unauthorized();
  }
  if (request.headers.get("authorization") !== `Bearer ${CLOUDFLARE_API_TOKEN}`) {
    return unauthorized();
  }
  const scripts = SCRIPTS.exec(url.pathname);
  if (scripts) {
    const [, account, namespace] = scripts;
    if (account !== CLOUDFLARE_ACCOUNT_ID || namespace !== "production") return unauthorized();
    const filter = /^(.+):yes$/.exec(url.searchParams.get("tags") ?? "");
    if (request.method !== "DELETE" || !filter) {
      return envelope(404, null, [{ code: 7003, message: "No route for that URI" }]);
    }
    const tag = filter[1]!;
    // A project's tag names its Project ID.
    const project = /([0-9a-f-]{36})$/.exec(tag)?.[1] ?? tag;
    return intercept(project, `DELETE scripts?tags=${tag}`, async () => {
      for (const [name, worker] of userWorkers) {
        if (worker.tags.includes(tag)) userWorkers.delete(name);
      }
      return envelope(200);
    });
  }
  const script = SCRIPT.exec(url.pathname);
  if (!script) return envelope(404, null, [{ code: 7003, message: "No route for that URI" }]);
  const [, account, namespace, encoded, session] = script;
  if (account !== CLOUDFLARE_ACCOUNT_ID || namespace !== "production") return unauthorized();
  const name = decodeURIComponent(encoded!);
  if (session) {
    if (request.method !== "POST") return envelope(405);
    const { manifest } = (await request.json()) as { manifest: Record<string, { hash: string }> };
    return intercept(projectOf(name), `POST assets-upload-session ${name}`, async () =>
      startAssetsSession(name, manifest),
    );
  }
  if (request.method === "PUT") {
    return intercept(projectOf(name), `PUT ${name}`, () => uploadScript(name, request));
  }
  if (request.method === "DELETE") {
    return intercept(projectOf(name), `DELETE ${name}`, async () => {
      if (failingDeletions.has(name)) {
        return envelope(500, null, [{ code: 10013, message: "An unknown error has occurred" }]);
      }
      if (!userWorkers.delete(name)) {
        return envelope(404, null, [
          { code: 10007, message: "This Worker does not exist on your account." },
        ]);
      }
      return envelope(200);
    });
  }
  return envelope(405);
}

/** Deploys a user Worker, as a release's `wrangler deploy` does, with no modules to read. */
export function deployUserWorker(name: string, build: string, tags: string[] = []) {
  userWorkers.set(name, {
    name,
    metadata: null,
    modules: { "index.js": { type: "application/javascript+module", text: `// ${build}\n` } },
    assets: {},
    tags,
  });
}

export const userWorker = (name: string) => userWorkers.get(name) ?? null;

/** The names of the user Workers of `project`, its own named after its Project ID included. */
export const userWorkersOf = (project: string) =>
  [...userWorkers.keys()].filter((name) => name.startsWith(project));

export const cloudflareCalls = (project: string) => calls.get(project) ?? [];

/** Makes every deletion of the user Worker `name` fail. */
export const failDeletionsOf = (name: string) => failingDeletions.add(name);

/** Makes the next `times` calls of `project` containing `pattern` fail, or land then fail. */
export function failCloudflareCalls(
  project: string,
  pattern: string,
  times: number,
  landing = false,
) {
  failing.push({ project, pattern, times, landing });
}

/** Makes the calls of `project` containing `pattern` wait until they're let go. */
export function holdCloudflareCalls(project: string, pattern: string) {
  held.push({ project, pattern });
}

export function letGoCloudflareCalls(project: string, pattern: string) {
  held = held.filter((hold) => hold.project !== project || hold.pattern !== pattern);
}
