import type { Bindings } from "../../types";

// Look tokens (ADR 0032): what the browser the agent's `look` tool drives reads a draft with,
// since a Thread holds no session. Each is read-only, names one project and one draft, and
// expires after a couple of minutes. Content access (`accessTo`) accepts it as a reader of its
// draft, beside a publishing draft's session-free read.

/** What a valid look token lets its bearer read: one draft of one project. */
export type LookGrant = { projectId: number; draftId: string };

/** How long a look token is valid: long enough for one `look` call's captures. */
export const LOOK_TOKEN_TTL_MS = 2 * 60_000;

type Payload = LookGrant & { expiresAt: number };

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** The key look tokens are signed with, derived from the API's auth secret. */
function signingKey(env: Pick<Bindings, "BETTER_AUTH_SECRET">) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(`camox-look-token:${env.BETTER_AUTH_SECRET}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Signs a look token for one `look` call, valid for `LOOK_TOKEN_TTL_MS` from now. */
export async function signLookToken(
  env: Pick<Bindings, "BETTER_AUTH_SECRET">,
  grant: LookGrant,
): Promise<string> {
  const payload: Payload = {
    projectId: grant.projectId,
    draftId: grant.draftId,
    expiresAt: Date.now() + LOOK_TOKEN_TTL_MS,
  };
  const body = base64url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await signingKey(env), encoder.encode(body));
  return `${body}.${base64url(new Uint8Array(signature))}`;
}

/** What a look token grants, or null when the API didn't sign it or it expired. */
export async function verifyLookToken(
  env: Pick<Bindings, "BETTER_AUTH_SECRET">,
  token: string,
): Promise<LookGrant | null> {
  const [body, signature, ...rest] = token.split(".");
  if (!body || !signature || rest.length) return null;
  try {
    const valid = await crypto.subtle.verify(
      "HMAC",
      await signingKey(env),
      fromBase64url(signature),
      encoder.encode(body),
    );
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64url(body))) as Payload;
    if (!(payload.expiresAt > Date.now())) return null;
    return { projectId: payload.projectId, draftId: payload.draftId };
  } catch {
    // Not base64 or not JSON: no token the API signed.
    return null;
  }
}
