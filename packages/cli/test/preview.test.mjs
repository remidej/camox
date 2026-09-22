import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const binary = fileURLToPath(new URL("../dist/index.mjs", import.meta.url));

void test("preview hands off a single-use credential and rejects unsafe destinations", async () => {
  const root = await mkdtemp(join(tmpdir(), "camox-preview-"));
  let requests = 0;
  let status = 200;
  const server = createServer((req, res) => {
    requests++;
    assert.equal(req.url, "/api/auth/one-time-token/generate");
    assert.equal(req.method, "GET");
    assert.equal(req.headers.authorization, "Bearer long-lived-secret");
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ token: "single-use-secret" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const apiUrl = `http://127.0.0.1:${server.address().port}`;
  async function cli(url) {
    try {
      return {
        ...(await exec(process.execPath, [binary, "preview", "--url", url, "--json"], {
          cwd: root,
          env: { ...process.env, HOME: root },
        })),
        code: 0,
      };
    } catch (error) {
      return { stdout: error.stdout, stderr: error.stderr, code: error.code };
    }
  }
  try {
    await mkdir(join(root, "node_modules/.camox"), { recursive: true });
    await mkdir(join(root, ".camox"));
    await writeFile(
      join(root, "node_modules/.camox/runtime.json"),
      JSON.stringify({
        projectSlug: "test",
        apiUrl,
        authenticationUrl: "https://auth.example.test",
      }),
    );
    await writeFile(
      join(root, ".camox/auth.json"),
      JSON.stringify({
        "https://auth.example.test": {
          token: "long-lived-secret",
          name: "Tester",
          email: "test@example.test",
        },
      }),
    );
    for (const destination of [
      "http://localhost:3000/about?foo=bar#heading",
      "http://[::1]:3000/about",
      "https://127.0.0.1/about",
    ]) {
      const result = await cli(destination);
      assert.equal(result.code, 0, result.stderr);
      const data = JSON.parse(result.stdout);
      const url = new URL(data.url);
      assert.equal(url.pathname, "/about");
      assert.equal(url.searchParams.get("ott"), "single-use-secret");
      assert.deepEqual(JSON.parse(url.searchParams.get("camox-preview")), {
        projectSlug: "test",
        apiUrl,
        environmentName: "dev:test@example.test",
      });
      assert.equal(data.source, "draft");
      assert.doesNotMatch(result.stdout, /long-lived-secret/);
    }
    const before = requests;
    for (const destination of [
      "https://example.com",
      "http://localhost.evil.test",
      "file:///tmp/site",
      "http://user:pass@localhost:3000",
      "not a URL",
    ]) {
      const result = await cli(destination);
      assert.equal(result.code, 2);
    }
    assert.equal(requests, before);
    status = 401;
    const failed = await cli("http://localhost:3000");
    assert.equal(failed.code, 2);
    assert.equal(failed.stdout, "");
    assert.doesNotMatch(failed.stderr, /single-use-secret|long-lived-secret/);
    await rm(join(root, ".camox/auth.json"));
    const missing = await cli("http://localhost:3000");
    assert.equal(JSON.parse(missing.stderr).code, "NOT_AUTHENTICATED");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
