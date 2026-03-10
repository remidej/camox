export const FS_PREFIX = "/fs";

export function getSiteUrl() {
  const convexUrl = (import.meta.env.VITE_CONVEX_URL ?? "") as string;
  if (convexUrl.includes(".cloud")) {
    return convexUrl.replace(/\.cloud$/, ".site");
  }
  throw new Error(
    "Could not derive Convex site URL. Set VITE_CONVEX_SITE_URL for non-cloud deployments.",
  );
}
