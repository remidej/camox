import { STUDIO_BASE_PATH } from "./routes";

/** A curated page as a locale's page list has it: its id, and its full path in that locale. */
type LocalizedPage = { id: string; fullPath: string };

/**
 * The locale-relative path switching to another locale goes to from `path`. A curated page keeps
 * its localization's path there, found by its id (ADR 0015). Studio routes and singleton pages
 * keep their code-owned path. Anything else, such as a page missing from the other locale or a
 * derived layout's record page, goes to that locale's home.
 */
export function pathInLocale(
  path: string,
  {
    shown,
    target,
    singleton,
  }: {
    /** The pages of the locale shown. */
    shown: readonly LocalizedPage[];
    /** The pages of the locale switched to. */
    target: readonly LocalizedPage[];
    /** Whether a path is a singleton layout's. */
    singleton: (path: string) => boolean;
  },
): string {
  if (path === STUDIO_BASE_PATH || path.startsWith(`${STUDIO_BASE_PATH}/`) || singleton(path))
    return path;
  const page = shown.find((candidate) => candidate.fullPath === path);
  return (page && target.find((candidate) => candidate.id === page.id)?.fullPath) ?? "/";
}
