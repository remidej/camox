/**
 * Better Auth's cookies as the cross-domain client keeps them: a JSON record in localStorage, by
 * cookie name, read back as a `Cookie` header's value. The Worker reads the same records when it
 * signs a member in itself. Adapted from `@convex-dev/better-auth/client/plugins`.
 */

interface CookieAttributes {
  value: string;
  expires?: Date;
  "max-age"?: number;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

export interface StoredCookie {
  value: string;
  expires: string | null;
}

export function parseSetCookieHeader(header: string): Map<string, CookieAttributes> {
  const cookieMap = new Map<string, CookieAttributes>();
  const cookies = header.split(", ");
  cookies.forEach((cookie) => {
    const [nameValue, ...attributes] = cookie.split("; ");
    const [name, value] = nameValue.split("=");

    const cookieObj: CookieAttributes = { value };

    attributes.forEach((attr) => {
      const [attrName, attrValue] = attr.split("=");
      cookieObj[attrName.toLowerCase() as "value"] = attrValue;
    });

    cookieMap.set(name, cookieObj);
  });

  return cookieMap;
}

export function getSetCookie(header: string, prevCookie?: string) {
  const parsed = parseSetCookieHeader(header);
  let toSetCookie: Record<string, StoredCookie> = {};
  parsed.forEach((cookie, key) => {
    const expiresAt = cookie["expires"];
    const maxAge = cookie["max-age"];
    let expires: Date | null = null;
    if (expiresAt) {
      expires = new Date(String(expiresAt));
    } else if (maxAge) {
      expires = new Date(Date.now() + Number(maxAge) * 1000);
    }
    toSetCookie[key] = {
      value: cookie["value"],
      expires: expires ? expires.toISOString() : null,
    };
  });
  if (prevCookie) {
    try {
      const prevCookieParsed = JSON.parse(prevCookie);
      toSetCookie = {
        ...prevCookieParsed,
        ...toSetCookie,
      };
    } catch {
      //
    }
  }
  return JSON.stringify(toSetCookie);
}

export function getCookie(cookie: string) {
  let parsed = {} as Record<string, StoredCookie>;
  try {
    parsed = JSON.parse(cookie) as Record<string, StoredCookie>;
  } catch {
    // noop
  }
  const parts: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (value.expires && new Date(value.expires) < new Date()) {
      continue;
    }
    parts.push(`${key}=${value.value}`);
  }
  return parts.join("; ");
}

/**
 * The stored cookies with those of a `Cookie` header's value added, when it holds one they don't:
 * a session the website's Worker signed in with. Null when they hold it already, even expired.
 */
export function withCookieHeader(stored: string, header: string): string | null {
  let parsed: Record<string, StoredCookie> = {};
  try {
    parsed = JSON.parse(stored) as Record<string, StoredCookie>;
  } catch {
    // An unreadable record holds nothing.
  }
  let added = false;
  for (const pair of header.split("; ")) {
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    const name = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    if (parsed[name]?.value === value) continue;
    // The header doesn't say when it expires: the API does, when it's next asked for the session.
    parsed[name] = { value, expires: null };
    added = true;
  }
  return added ? JSON.stringify(parsed) : null;
}
