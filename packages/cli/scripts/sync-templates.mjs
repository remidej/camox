import { spawn } from "node:child_process";
import { readFileSync, watch } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { copyTemplateSource, isExcludedTemplatePath, readCatalog } from "../src/lib/template.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const TEMPLATES = [{ src: "apps/template-default", dest: "packages/cli/templates/default" }];

function syncAll() {
  const catalog = readCatalog(readFileSync(path.join(REPO_ROOT, "pnpm-workspace.yaml"), "utf-8"));
  for (const { src, dest } of TEMPLATES) {
    copyTemplateSource(path.join(REPO_ROOT, src), path.join(REPO_ROOT, dest), catalog);
  }
}

const args = new Set(process.argv.slice(2));
const isWatch = args.has("--watch");
const withBuild = args.has("--build");

syncAll();
console.info(`[sync-templates] Synced ${TEMPLATES.length} template(s).`);

if (withBuild) {
  const child = spawn("vp", ["pack", "--watch"], { stdio: "inherit", shell: false });
  const forward = (sig) => child.kill(sig);
  process.on("SIGINT", forward);
  process.on("SIGTERM", forward);
  child.on("exit", (code) => process.exit(code ?? 0));
}

if (isWatch) {
  let pending = false;
  let timer = null;
  const debounced = () => {
    if (pending) return;
    pending = true;
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        syncAll();
        console.info("[sync-templates] Re-synced after change.");
      } catch (err) {
        console.error("[sync-templates] Sync failed:", err);
      } finally {
        pending = false;
      }
    }, 80);
  };

  for (const { src } of TEMPLATES) {
    const srcAbs = path.join(REPO_ROOT, src);
    watch(srcAbs, { recursive: true }, (_event, filename) => {
      // Skip changes inside excluded paths so we don't churn on autogen files.
      if (filename && isExcludedTemplatePath(filename)) return;
      debounced();
    });
  }
  console.info("[sync-templates] Watching for changes...");
}
