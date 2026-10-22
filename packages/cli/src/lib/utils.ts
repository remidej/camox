export type PackageManager = "pnpm" | "bun" | "npm";

export const packageManagerVersions: Record<PackageManager, string> = {
  pnpm: "pnpm@11.1.3",
  bun: "bun@1.2.23",
  npm: "npm@11.6.2",
};
