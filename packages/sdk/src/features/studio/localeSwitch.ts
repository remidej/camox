import { STUDIO_BASE_PATH } from "./routes";

/** A curated page as a locale's page list has it: its id, and its full path in that locale. */
type LocalizedPage = { id: string; fullPath: string };

/**
 * The locale-relative path switching to another locale goes to from `path`. A curated page keeps
 * its localization's path there, found by its id (ADR 0015). Studio routes and singleton pages
 * keep their code-owned path. A derived layout's record page goes to the record's page there, as
 * that locale's route discovery finds it. Anything else, such as a page missing from the other
 * locale, goes to that locale's home.
 */
export function pathInLocale(
  path: string,
  {
    shown,
    target,
    singleton,
    recordPath,
  }: {
    /** The pages of the locale shown. */
    shown: readonly LocalizedPage[];
    /** The pages of the locale switched to. */
    target: readonly LocalizedPage[];
    /** Whether a path is a singleton layout's. */
    singleton: (path: string) => boolean;
    /** The path, in the locale switched to, of the record page shown, if one is and it has it. */
    recordPath?: string | null;
  },
): string {
  if (path === STUDIO_BASE_PATH || path.startsWith(`${STUDIO_BASE_PATH}/`) || singleton(path))
    return path;
  // A curated page takes precedence over a derived layout's on the same path, as on the server.
  const page = shown.find((candidate) => candidate.fullPath === path);
  if (page) return target.find((candidate) => candidate.id === page.id)?.fullPath ?? "/";
  return recordPath ?? "/";
}
