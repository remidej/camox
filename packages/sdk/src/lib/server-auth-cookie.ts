export const SERVER_AUTH_COOKIE_NAME = "camox_auth_cookie";

/** How long the mirror lasts. The API still refuses a session that expired before it. */
const SERVER_AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export function buildClearServerAuthCookieHeader() {
  return `${SERVER_AUTH_COOKIE_NAME}=; Path=/; SameSite=Lax; Max-Age=0`;
}

/** Sets the mirror to a session, as a `Cookie` header's value. */
export function buildServerAuthCookieHeader(cookie: string, { secure }: { secure: boolean }) {
  return `${SERVER_AUTH_COOKIE_NAME}=${encodeURIComponent(cookie)}; Path=/; SameSite=Lax; Max-Age=${SERVER_AUTH_COOKIE_MAX_AGE}${secure ? "; Secure" : ""}`;
}

/**
 * The session to forward to the API for validation; cookie presence is not authentication. Only
 * the studio's session counts, which the SDK mirrors into `camox_auth_cookie`. Better Auth's own
 * cookies don't: on a Custom Domain like camox.ai they're the dashboard's session, set for every
 * host (ADR 0028). Mirrored in apps/dispatch/src/previews.ts: keep the two in sync.
 */
export function getServerAuthCookieHeader(headers: Headers): string {
  return readServerAuthCookie(headers.get("Cookie") ?? "");
}

/** The mirror's session in a `Cookie` header's value, or `document.cookie`. */
export function readServerAuthCookie(cookieHeader: string): string {
  const cookies = cookieHeader.split(";").map((part) => part.trim());
  const mirror = cookies.find((part) => part.startsWith(`${SERVER_AUTH_COOKIE_NAME}=`));
  if (!mirror) return "";
  try {
    return decodeURIComponent(mirror.slice(SERVER_AUTH_COOKIE_NAME.length + 1));
  } catch {
    // A malformed mirror is no session.
    return "";
  }
}
