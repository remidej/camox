#!/usr/bin/env node
// Regenerates every brand asset into art/ by running brand-book.html in headless Chrome, the
// same code path as the page's previews and .zip download.
//
//   node art/export.mjs                       (set CHROME_PATH if Chrome isn't found)
//   node art/export.mjs --tagline "Some text"  (banner tagline; "" for none)
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ART = dirname(fileURLToPath(import.meta.url));

const taglineFlag = process.argv.indexOf("--tagline");
const page = new URL(pathToFileURL(join(ART, "brand-book.html")));
if (taglineFlag !== -1) page.searchParams.set("tagline", process.argv[taglineFlag + 1] ?? "");

const chrome = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].find((p) => p && existsSync(p));
if (!chrome) {
  console.error("Couldn't find Chrome or Chromium. Set CHROME_PATH to its executable.");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9300 + Math.floor(Math.random() * 600);
// A throwaway profile, so this never attaches to an already running Chrome.
const profile = mkdtempSync(join(tmpdir(), "camox-brand-"));
const browser = spawn(
  chrome,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    page.href,
  ],
  { stdio: "ignore" },
);

try {
  let target;
  for (let i = 0; i < 100 && !target; i++) {
    await sleep(200);
    target = await fetch(`http://127.0.0.1:${port}/json`)
      .then((r) => r.json())
      .then((targets) => targets.find((t) => t.type === "page"))
      .catch(() => undefined);
  }
  if (!target) throw new Error("Chrome didn't start");

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let nextId = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
    pending.get(msg.id)?.(msg);
  });
  const evaluate = (expression) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, ({ result }) => {
        if (result?.exceptionDetails)
          reject(new Error(result.exceptionDetails.exception?.description));
        else resolve(result?.result?.value);
      });
      ws.send(
        JSON.stringify({
          id,
          method: "Runtime.evaluate",
          params: { expression, returnByValue: true, awaitPromise: true },
        }),
      );
    });

  for (let i = 0; i < 100; i++) {
    if (await evaluate(`document.readyState === "complete" && typeof buildAll === "function"`))
      break;
    await sleep(200);
  }

  const paths = await evaluate(`buildAll().then((files) => {
    window.__exports = files;
    return files.map((f) => f.path);
  })`);
  const managed = await evaluate(`MANAGED`);
  for (const dir of managed) rmSync(join(ART, dir), { recursive: true, force: true });

  for (const [i, path] of paths.entries()) {
    const base64 = await evaluate(`(() => {
      const bytes = window.__exports[${i}].bytes;
      let bin = "";
      for (let j = 0; j < bytes.length; j += 0x8000) bin += String.fromCharCode(...bytes.subarray(j, j + 0x8000));
      return btoa(bin);
    })()`);
    const dest = join(ART, path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, Buffer.from(base64, "base64"));
  }
  console.log(`Wrote ${paths.length} files into ${managed.map((d) => `art/${d}/`).join(", ")}`);
  ws.close();
} finally {
  browser.kill();
  rmSync(profile, { recursive: true, force: true });
}
