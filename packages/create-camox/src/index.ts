import { execSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as p from "@clack/prompts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ownPkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "package.json"), "utf-8"));

type PackageManager = "pnpm" | "bun" | "npm" | "yarn";

const pmCommands: Record<PackageManager, { install: string; dev: string }> = {
  pnpm: { install: "pnpm install", dev: "pnpm dev" },
  bun: { install: "bun install", dev: "bun dev" },
  npm: { install: "npm install", dev: "npm run dev" },
  yarn: { install: "yarn install", dev: "yarn dev" },
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function detectPackageManager(): PackageManager | null {
  // 1. Check npm_config_user_agent (set by pnpm create, npx, bunx, yarn create)
  const userAgent = process.env.npm_config_user_agent;
  if (userAgent) {
    const name = userAgent.split("/")[0];
    if (name === "pnpm") return "pnpm";
    if (name === "bun") return "bun";
    if (name === "npm" || name === "npx") return "npm";
    if (name === "yarn") return "yarn";
  }

  // 2. Walk ancestor directories looking for lockfiles
  let dir = process.cwd();
  const root = path.parse(dir).root;
  while (true) {
    if (
      fs.existsSync(path.join(dir, "pnpm-lock.yaml")) ||
      fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))
    )
      return "pnpm";
    if (fs.existsSync(path.join(dir, "bun.lockb")) || fs.existsSync(path.join(dir, "bun.lock")))
      return "bun";
    if (fs.existsSync(path.join(dir, "package-lock.json"))) return "npm";
    if (fs.existsSync(path.join(dir, "yarn.lock"))) return "yarn";

    if (dir === root) break;
    dir = path.dirname(dir);
  }

  return null;
}

function isInsideGitRepo(): boolean {
  try {
    execSync("git rev-parse --is-inside-work-tree", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function copyDir(src: string, dest: string, replacements: Record<string, string>) {
  fs.mkdirSync(dest, { recursive: true });

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, replacements);
      continue;
    }

    let content = fs.readFileSync(srcPath, "utf-8");
    for (const [key, value] of Object.entries(replacements)) {
      content = content.replaceAll(key, value);
    }
    fs.writeFileSync(destPath, content);
  }
}

function onCancel() {
  p.cancel("Cancelled.");
  process.exit(0);
}

async function main() {
  p.intro("create-camox");

  const result = await p.group(
    {
      name: () =>
        p.text({
          message: "Project display name",
          placeholder: "My Website",
          validate: (value) => {
            if (!value.trim()) return "Project name is required";
          },
        }),
      slug: ({ results }) =>
        p.text({
          message: "Project slug",
          initialValue: slugify(results.name ?? ""),
          validate: (value) => {
            if (!value.trim()) return "Slug is required";
            if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(value) && !/^[a-z0-9]$/.test(value)) {
              return "Slug must be lowercase alphanumeric with hyphens";
            }
          },
        }),
      path: ({ results }) =>
        p.text({
          message: "Project path",
          initialValue: `./${results.slug ?? "my-site"}`,
          validate: (value) => {
            if (!value.trim()) return "Path is required";
          },
        }),
    },
    { onCancel },
  );

  const targetDir = path.resolve(result.path);

  if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
    p.cancel(`Directory ${targetDir} is not empty.`);
    process.exit(1);
  }

  // Git init prompt
  const alreadyInRepo = isInsideGitRepo();
  const initGit = await p.confirm({
    message: "Initialize a git repository?",
    initialValue: !alreadyInRepo,
  });
  if (p.isCancel(initGit)) return onCancel();

  // Package manager
  const detected = detectPackageManager();
  let pm: PackageManager;

  if (detected) {
    pm = detected;
    p.log.info(`Detected package manager: ${detected}`);
  } else {
    const selected = await p.select({
      message: "Which package manager?",
      options: [
        { value: "pnpm" as const, label: "pnpm" },
        { value: "bun" as const, label: "bun" },
        { value: "npm" as const, label: "npm" },
        { value: "yarn" as const, label: "yarn" },
      ],
    });
    if (p.isCancel(selected)) return onCancel();
    pm = selected;
  }

  // Scaffold
  const s = p.spinner();
  s.start("Scaffolding project...");

  const templateDir = path.resolve(__dirname, "..", "template");
  copyDir(templateDir, targetDir, {
    "{{projectName}}": result.name,
    "{{projectSlug}}": result.slug,
    "{{camoxVersion}}": ownPkg.version,
  });

  s.stop("Project scaffolded!");

  // Git init
  if (initGit) {
    try {
      execSync("git init", { cwd: targetDir, stdio: "ignore" });
      p.log.success("Initialized git repository.");
    } catch {
      p.log.warn("Could not initialize git repository.");
    }
  }

  // Install dependencies
  const { install: installCmd, dev: devCmd } = pmCommands[pm];
  const [installBin, ...installArgs] = installCmd.split(" ");
  const s2 = p.spinner();
  s2.start(`Running ${installCmd}...`);
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(installBin, installArgs, {
        cwd: targetDir,
        stdio: "ignore",
      });
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Exit code ${code}`));
      });
      child.on("error", reject);
    });
    s2.stop("Dependencies installed!");
  } catch {
    s2.stop("Install failed.");
    p.log.error(`Failed to install dependencies. Run "${installCmd}" manually.`);
    process.exit(1);
  }

  // Initial commit
  if (initGit) {
    try {
      execSync("git add -A", { cwd: targetDir, stdio: "ignore" });
      execSync('git commit -m "Initial commit from create-camox"', {
        cwd: targetDir,
        stdio: "ignore",
      });
      p.log.success("Created initial commit.");
    } catch {
      p.log.warn("Could not create initial commit.");
    }
  }

  // Start dev server
  p.outro(`Starting dev server...`);

  const [cmd, ...args] = devCmd.split(" ");
  const child = spawn(cmd, args, {
    cwd: targetDir,
    stdio: "inherit",
  });

  child.on("close", () => {
    const shell = process.env.SHELL || "/bin/bash";
    p.log.info(`Dropping you into ${result.path}`);
    spawnSync(shell, [], { cwd: targetDir, stdio: "inherit" });
    process.exit(0);
  });
}

main().catch(console.error);
