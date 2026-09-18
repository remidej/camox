export const SERVER_AUTH_COOKIE_NAME = "camox_auth_cookie";

export function buildClearServerAuthCookieHeader() {
  return `${SERVER_AUTH_COOKIE_NAME}=; Path=/; SameSite=Lax; Max-Age=0`;
}

/** Forward credentials to the API for validation; cookie presence is not authentication.
 * Cross-domain sessions use the mirror. Same-host sessions (including localhost
 * on different ports) may only have Better Auth's native, HttpOnly cookie.
 */
export function getServerAuthCookieHeader(headers: Headers): string {
  const cookies = (headers.get("Cookie") ?? "").split(";").map((part) => part.trim());
  const mirror = cookies.find((part) => part.startsWith(`${SERVER_AUTH_COOKIE_NAME}=`));
  if (mirror) {
    try {
      const value = decodeURIComponent(mirror.slice(SERVER_AUTH_COOKIE_NAME.length + 1));
      if (value) return value;
    } catch {
      // A malformed mirror should not prevent a valid native session from working.
    }
  }

  // Don't forward unrelated application cookies to the API, or decode native
  // values: Better Auth must receive the signed cookie exactly as the browser sent it.
  return cookies
    .filter(
      (part) =>
        part.startsWith("better-auth.session_token=") ||
        part.startsWith("__Secure-better-auth.session_token="),
    )
    .join("; ");
}
