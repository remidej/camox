import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as p from "@clack/prompts";
import { object } from "@optique/core/constructs";
import { command, constant } from "@optique/core/primitives";
import slugify from "slugify";

import {
  type Organization,
  checkSlugAvailability,
  createOrganization,
  createProject,
  listOrganizations,
  setActiveOrganization,
} from "../lib/api";
import { getOrAuthenticate, readAuthToken } from "../lib/auth";
import { makeStandalone, personalize } from "../lib/template";
import { type PackageManager, type PackageManagerCommand, copyDir, pmCommands } from "../lib/utils";

export const parser = command(
  "init",
  object({
    command: constant("init"),
  }),
);

export const handler = init;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ownPkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "package.json"), "utf-8"));

class CommandError extends Error {
  constructor(
    message: string,
    readonly cause: unknown,
  ) {
    super(message);
  }
}

function onCancel() {
  p.cancel("Cancelled.");
  process.exit(0);
}

function runCommand(bin: string, args: string[], cwd: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd,
      stdio: "ignore",
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Exit code ${code}`));
    });
    child.on("error", (err) => reject(new CommandError(`Failed to start ${bin}`, err)));
  });
}

function spawnCommand(bin: string, args: string[], cwd: string) {
  return spawn(bin, args, {
    cwd,
    stdio: "inherit",
    detached: true,
  });
}

function isMissingCommandError(err: unknown) {
  if (!(err instanceof CommandError)) return false;

  const cause = err.cause;
  if (!(cause instanceof Error) || "code" in cause === false) return false;

  return cause.code === "ENOENT";
}

async function runPackageManagerCommand(command: PackageManagerCommand, cwd: string) {
  try {
    await runCommand(command.bin, command.args, cwd);
  } catch (err) {
    if (!isMissingCommandError(err) || !command.fallback) {
      throw err;
    }

    await runCommand(command.fallback.bin, command.fallback.args, cwd);
  }
}

function startPackageManagerCommand(command: PackageManagerCommand, cwd: string) {
  return new Promise<ReturnType<typeof spawn>>((resolve, reject) => {
    const child = spawnCommand(command.bin, command.args, cwd);
    child.once("spawn", () => resolve(child));
    child.once("error", (err) => {
      const commandError = new CommandError(`Failed to start ${command.bin}`, err);
      if (!isMissingCommandError(commandError) || !command.fallback) {
        reject(commandError);
        return;
      }

      const fallback = spawnCommand(command.fallback.bin, command.fallback.args, cwd);
      fallback.once("spawn", () => resolve(fallback));
      fallback.once("error", (fallbackErr) =>
        reject(new CommandError(`Failed to start ${command.fallback?.bin}`, fallbackErr)),
      );
    });
  });
}

function getCommandFailureMessage(pm: PackageManager, err: unknown) {
  if (!isMissingCommandError(err)) {
    return "Failed to install dependencies.";
  }

  if (pm === "pnpm") {
    return "Corepack or pnpm is required to install dependencies with the selected package manager. Enable Corepack with `corepack enable` or install pnpm, then run the setup commands below.";
  }

  if (pm === "bun") {
    return "Bun is required to install dependencies with the selected package manager. Install Bun, then run the setup commands below.";
  }

  return "npm is required to install dependencies. Install npm, then run the setup commands below.";
}

const CREATE_NEW_ORG = "__create_new__" as const;

async function selectOrCreateOrganization(token: string): Promise<string> {
  const orgs = await listOrganizations(token);

  if (orgs.length === 0) {
    // No orgs — prompt to create one
    p.log.info("You don't have any organizations yet. Let's create one.");
    return promptCreateOrganization(token);
  }

  // Has orgs — let user pick or create new
  const selected = await p.select({
    message: "Select an organization for your new project",
    options: [
      ...orgs.map((org: Organization) => ({ value: org.id, label: `${org.name} (${org.slug})` })),
      { value: CREATE_NEW_ORG, label: "Create a new organization" },
    ],
  });
  if (p.isCancel(selected)) return onCancel() as never;

  if (selected === CREATE_NEW_ORG) {
    return promptCreateOrganization(token);
  }

  // Set active org and return id
  const org = orgs.find((o: Organization) => o.id === selected)!;
  await setActiveOrganization(token, org.id);
  return org.id;
}

async function promptCreateOrganization(token: string): Promise<string> {
  const orgName = await p.text({
    message: "Organization name",
    placeholder: "My Company",
    validate: (value) => {
      if (!value?.trim()) return "Organization name is required";
    },
  });
  if (p.isCancel(orgName)) return onCancel() as never;

  const orgSlug = slugify(orgName, { lower: true, strict: true });
  const org = await createOrganization(token, orgName, orgSlug);
  p.log.success(`Created organization: ${org.name}`);
  return org.id;
}

export async function init() {
  p.intro(`Camox v${ownPkg.version}`);
  const stored = readAuthToken();
  if (stored) {
    p.log.info(`Welcome back, ${stored.name}!`);
  }
  p.log.info("Let's create your Camox application.");

  // Project name
  const name = await p.text({
    message: "Project display name",
    placeholder: "My Website",
    validate: (value) => {
      if (!value?.trim()) return "Project name is required";
    },
  });
  if (p.isCancel(name)) return onCancel();

  // Authenticate with the Camox Dashboard
  const auth = await getOrAuthenticate();

  // Organization selection
  const orgId = await selectOrCreateOrganization(auth.token);

  // Project slug (user-defined, validated for availability)
  let projectSlug: string;
  while (true) {
    const slugInput = await p.text({
      message: "Project slug",
      initialValue: slugify(name, { lower: true, strict: true }) || "my-site",
      validate: (value) => {
        if (!value?.trim()) return "Slug is required";
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
          return "Slug must be lowercase alphanumeric with hyphens";
        }
      },
    });
    if (p.isCancel(slugInput)) return onCancel();

    const s = p.spinner();
    s.start("Checking slug availability...");
    const { available } = await checkSlugAvailability(auth.token, slugInput);
    if (available) {
      s.stop("Slug is available!");
      projectSlug = slugInput;
      break;
    }
    s.stop(`Slug "${slugInput}" is already taken. Please choose another.`);
  }

  // Project path (pre-filled from slug, validated for emptiness)
  const projectPath = await p.text({
    message: "Project path",
    initialValue: `./${projectSlug}`,
    validate: (value) => {
      if (!value?.trim()) return "Path is required";
      const resolved = path.resolve(value);
      if (fs.existsSync(resolved) && fs.readdirSync(resolved).length > 0) {
        return "Directory is not empty";
      }
    },
  });
  if (p.isCancel(projectPath)) return onCancel();

  const resolvedPath = projectPath as string;
  const targetDir = path.resolve(resolvedPath);

  // Create project on API
  const s0 = p.spinner();
  s0.start("Creating project...");
  let project: { slug: string };
  try {
    project = await createProject(auth.token, name, projectSlug, orgId);
    s0.stop(`Project created with slug: ${project.slug}`);
  } catch (err) {
    s0.error("Failed to create project.");
    p.log.error(err instanceof Error ? err.message : "Unknown error");
    process.exit(1);
  }

  // Package manager
  const selected = await p.select({
    message: "Which package manager?",
    options: [
      { value: "pnpm" as const, label: "pnpm (recommended)" },
      { value: "bun" as const, label: "bun" },
      { value: "npm" as const, label: "npm" },
    ],
  });
  if (p.isCancel(selected)) return onCancel();
  const pm: PackageManager = selected;

  // Scaffold
  const s = p.spinner();
  s.start("Scaffolding project...");

  const templateDir = path.resolve(__dirname, "..", "templates", "default");
  copyDir(templateDir, targetDir, {
    "{{projectName}}": name,
  });
  makeStandalone(targetDir, { camoxVersion: ownPkg.version, packageManager: pm });
  personalize(targetDir, project.slug);

  s.stop("Project scaffolded!");

  // Install dependencies
  const { install: installCmd, dev: devCmd } = pmCommands[pm];
  const s2 = p.spinner();
  s2.start(`Running ${installCmd.display}...`);
  try {
    await runPackageManagerCommand(installCmd, targetDir);
    s2.stop("Dependencies installed!");
  } catch (err) {
    s2.error("Install failed.");
    p.log.error(getCommandFailureMessage(pm, err));
    p.outro(`To finish setup:\n  cd ${resolvedPath}\n  ${installCmd.display}\n  ${devCmd.display}`);
    process.exit(1);
  }

  // Start dev server
  p.log.info(`Starting dev server... (Ctrl+C to stop)`);

  // Spawn in its own process group so Ctrl+C (SIGINT) doesn't reach it
  // directly — that would cause pnpm to print ELIFECYCLE noise.
  let child: ReturnType<typeof spawn>;
  try {
    child = await startPackageManagerCommand(devCmd, targetDir);
  } catch (err) {
    p.log.error(getCommandFailureMessage(pm, err));
    p.outro(`To start the dev server:\n  cd ${resolvedPath}\n  ${devCmd.display}`);
    process.exit(1);
  }

  // Intercept Ctrl+C: send SIGTERM to the child's entire process group
  // for a clean shutdown (kills pnpm + vite + all children).
  const sigintHandler = () => {
    if (child.pid) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {}
    }
  };
  process.on("SIGINT", sigintHandler);

  // If the parent exits unexpectedly, make sure the child tree doesn't linger.
  process.on("exit", sigintHandler);

  child.on("close", () => {
    process.removeListener("SIGINT", sigintHandler);
    process.removeListener("exit", sigintHandler);
    p.outro(`To restart the dev server:\n  cd ${resolvedPath}\n  ${devCmd.display}`);
    process.exit(0);
  });
}
