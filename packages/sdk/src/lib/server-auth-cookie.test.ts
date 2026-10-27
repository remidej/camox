import assert from "node:assert/strict";
import { test } from "node:test";

import { getServerAuthCookieHeader } from "./server-auth-cookie";

void test("uses the cross-domain mirror when present", () => {
  const cookie = "better-auth.session_token=token.signature%3D";
  assert.equal(
    getServerAuthCookieHeader(
      new Headers({
        Cookie: `camox_auth_cookie=${encodeURIComponent(cookie)}; better-auth.session_token=other`,
      }),
    ),
    cookie,
  );
});

void test("ignores native session cookies, which on camox.ai are the dashboard's session", () => {
  for (const name of ["better-auth.session_token", "__Secure-better-auth.session_token"]) {
    for (const mirror of ["", "camox_auth_cookie=; ", "camox_auth_cookie=%ZZ; "]) {
      assert.equal(
        getServerAuthCookieHeader(
          new Headers({ Cookie: `${mirror}theme=dark; ${name}=token.signature%3D` }),
        ),
        "",
      );
    }
  }
});

void test("anonymous and unrelated cookies supply no credentials", () => {
  for (const cookie of ["", "theme=dark", "camox_auth_cookie=%ZZ", "other.session_token=token"]) {
    assert.equal(getServerAuthCookieHeader(new Headers({ Cookie: cookie })), "");
  }
});
