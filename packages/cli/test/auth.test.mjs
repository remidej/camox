import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  readAuthTokenForUrl,
  writeAuthTokenForUrl,
  removeAuthTokenForUrl,
} from "../dist/lib/auth-core.mjs";

void test("checkout credentials override by URL without leaking global identities", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "camox-auth-"));
  const cwd = process.cwd();
  const home = process.env.HOME;
  const localUrl = "http://localhost:3274";
  const productionUrl = "https://app.camox.dev";
  const token = (name) => ({ name, email: `${name}@example.com`, token: name });
  const save = (file, contents) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(contents));
  };
  try {
    process.env.HOME = path.join(temporary, "home");
    const globalFile = path.join(os.homedir(), ".camox/auth.json");
    save(globalFile, { [localUrl]: token("global"), [productionUrl]: token("production") });
    const repo = path.join(temporary, "repo");
    const localFile = path.join(repo, ".camox/auth.json");
    save(localFile, { [localUrl]: token("local") });
    fs.writeFileSync(path.join(repo, ".git"), "gitdir: /unused/worktree");
    fs.mkdirSync(path.join(repo, "apps/site"), { recursive: true });
    process.chdir(path.join(repo, "apps/site"));
    assert.equal(readAuthTokenForUrl(`${localUrl}/`).token, "local");
    assert.equal(readAuthTokenForUrl(productionUrl).token, "production");
    const otherRepo = path.join(temporary, "other-repo");
    save(path.join(otherRepo, ".camox/auth.json"), { [localUrl]: token("other") });
    fs.mkdirSync(path.join(otherRepo, ".git"));
    assert.equal(readAuthTokenForUrl(localUrl, otherRepo).token, "other");
    assert.equal(readAuthTokenForUrl(localUrl).token, "local");
    writeAuthTokenForUrl(localUrl, token("updated"));
    assert.equal(readAuthTokenForUrl(localUrl).token, "updated");
    assert.equal(fs.statSync(localFile).mode & 0o777, 0o600);
    removeAuthTokenForUrl(localUrl);
    assert.equal(readAuthTokenForUrl(localUrl), null);
    assert.equal(JSON.parse(fs.readFileSync(globalFile))[localUrl].token, "global");
    writeAuthTokenForUrl(localUrl, token("relogin"));
    assert.equal(readAuthTokenForUrl(localUrl).token, "relogin");
    save(localFile, { [localUrl]: { token: "invalid" } });
    assert.equal(readAuthTokenForUrl(localUrl), null);
    fs.writeFileSync(localFile, "broken json");
    assert.throws(() => readAuthTokenForUrl(localUrl));
    fs.rmSync(localFile);
    assert.equal(readAuthTokenForUrl(localUrl).token, "global");
    // Stop at the nearest repo, even if a parent repo has local credentials.
    save(localFile, { [localUrl]: token("parent") });
    fs.mkdirSync(path.join(repo, "apps/site/.git"));
    assert.equal(readAuthTokenForUrl(localUrl).token, "global");
    process.chdir(temporary);
    assert.equal(readAuthTokenForUrl(localUrl).token, "global");
    removeAuthTokenForUrl(productionUrl);
    assert.equal(readAuthTokenForUrl(productionUrl), null);
  } finally {
    process.chdir(cwd);
    if (home === undefined) delete process.env.HOME;
    else process.env.HOME = home;
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
