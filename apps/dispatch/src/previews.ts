import type { RevisionToLoad } from "./revisions";

// Which requests a draft with code's previewed revision answers (ADR 0023): the renderer document
// and the runtime reads, for a member who can see the draft. The API says who that is, and which
// revision the draft previews.

/** The runtime routes a draft with code's revision answers, everything else being Live's code's. */
const REVISION_ROUTES = new Set(["/_camox/renderer", "/_camox/data", "/_camox/routes"]);
/** The route whose every request asks the API afresh: a reload after a new revision loads it. */
const RENDERER_DOCUMENT = "/_camox/renderer";

/** The URL search param naming the draft a request shows (ADR 0011). */
const DRAFT_SEARCH_PARAM = "camox-draft";

/** The SDK's cookie mirroring a cross-domain session on a website's host (`server-auth-cookie.ts`). */
const MIRROR_COOKIE = "camox_auth_cookie";
/** Better Auth's own session cookies, which a session made on the website's host is in. */
const SESSION_COOKIES = ["better-auth.session_token=", "__Secure-better-auth.session_token="];

/** How long an answer of the API is kept for the same session and draft. */
export const PREVIEW_ANSWER_TTL_MS = 2_000;

/** What dispatch asks the API's `CamoxPreviews` entrypoint, over its `API` service binding. */
export interface PreviewsApi {
  /**
   * The revision the draft `draft` of the project `project` (its Project ID) previews, when the
   * session `session` (a `Cookie` header's value) belongs to a member who can see the draft.
   * Null otherwise, or when the draft has no previewed revision.
   */
  previewedRevision(question: {
    project: string;
    draft: string;
    session: string;
  }): Promise<RevisionToLoad | null>;
}

/**
 * The session a request carries, as the SDK forwards it to the API: the mirror cookie's session
 * when there is one, else Better Auth's own cookies, else nothing. Mirrored from
 * packages/sdk/src/lib/server-auth-cookie.ts: keep the two in sync.
 */
export function sessionOf(headers: Headers): string {
  const cookies = (headers.get("cookie") ?? "").split(";").map((part) => part.trim());
  const mirror = cookies.find((part) => part.startsWith(`${MIRROR_COOKIE}=`));
  if (mirror) {
    try {
      const value = decodeURIComponent(mirror.slice(MIRROR_COOKIE.length + 1));
      if (value) return value;
    } catch {
      // A malformed mirror doesn't hide a native session.
    }
  }
  return cookies.filter((part) => SESSION_COOKIES.some((name) => part.startsWith(name))).join("; ");
}

type Answer = { at: number; revision: Promise<RevisionToLoad | null> };

/** The API's recent answers in this isolate, by its binding, then project, draft and session. */
const answersOf = new WeakMap<PreviewsApi, Map<string, Answer>>();

/** Forgets answers older than they're kept, so the map doesn't grow with every session. */
function forgetStale(answers: Map<string, Answer>, now: number) {
  for (const [key, answer] of answers) {
    if (now - answer.at > PREVIEW_ANSWER_TTL_MS) answers.delete(key);
  }
}

/**
 * The revision a request to `project`'s website is answered by: its draft's previewed revision,
 * for a renderer document or runtime read naming a draft with code that its session can see.
 * Null for every other request, which Live's code answers. An API that can't answer leaves the
 * request to Live's code too: a draft's code is only ever shown to whom the API allowed.
 */
export async function revisionFor(
  api: PreviewsApi,
  project: string,
  request: Request,
): Promise<RevisionToLoad | null> {
  const url = new URL(request.url);
  if (!REVISION_ROUTES.has(url.pathname)) return null;
  const draft = url.searchParams.get(DRAFT_SEARCH_PARAM);
  if (!draft) return null;
  const session = sessionOf(request.headers);
  if (!session) return null;

  const answers = answersOf.get(api) ?? new Map<string, Answer>();
  answersOf.set(api, answers);
  const now = Date.now();
  forgetStale(answers, now);
  const key = JSON.stringify([project, draft, session]);
  let answer = answers.get(key);
  if (!answer || url.pathname === RENDERER_DOCUMENT) {
    answer = { at: now, revision: api.previewedRevision({ project, draft, session }) };
    answers.set(key, answer);
    // A failed answer isn't kept: the next request asks again.
    answer.revision.catch(() => answers.get(key) === answer && answers.delete(key));
  }
  try {
    return await answer.revision;
  } catch (error) {
    console.error("The API couldn't say which revision a draft previews", error);
    return null;
  }
}
