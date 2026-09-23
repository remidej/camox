#!/usr/bin/env node
if (process.argv[2] === "typegen") {
  // Resolve config without starting a server or requiring a logged-in build.
  const { resolveConfig } = await import("vite-plus");
  await resolveConfig({}, "serve");
  // Config plugins can leave watchers alive even without a dev server.
  process.exit(0);
} else {
  await import("@camox/cli");
}
