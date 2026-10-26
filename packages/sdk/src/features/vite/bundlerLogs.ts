import type { UserConfig } from "vite-plus";

export type BundlerOnLog = NonNullable<
  NonNullable<NonNullable<UserConfig["build"]>["rollupOptions"]>["onLog"]
>;

type BundlerLog = Parameters<BundlerOnLog>[1];

/** Wraps the app's own `onLog`, if any, so it never sees warnings every Camox app produces. */
export function withoutExpectedCamoxLogs(onLog?: BundlerOnLog): BundlerOnLog {
  return (level, log, handler) => {
    if (isExpectedCamoxLog(log)) return;
    if (onLog) return onLog(level, log, handler);
    handler(level, log);
  };
}

function isExpectedCamoxLog(log: BundlerLog): boolean {
  // React libraries mark their modules "use client" for React Server Components.
  // Camox apps don't use them, so bundling drops the directive, as it should.
  if (log.code === "MODULE_LEVEL_DIRECTIVE") return log.message.includes('"use client"');
  // The server imports every block up front and the browser loads each one on
  // demand, so a block a layout also imports can't move to its own chunk.
  if (log.code === "INEFFECTIVE_DYNAMIC_IMPORT") return log.message.includes("virtual:camox/app");
  // The Worker inlines the app's stylesheet for page images, and Tailwind's plugin compiles it
  // without a sourcemap. A stylesheet has no code to map.
  if (log.code === "SOURCEMAP_BROKEN") return log.message.includes("(@tailwindcss/vite:");
  return false;
}
