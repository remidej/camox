import { readFile } from "node:fs/promises";

/**
 * The home page hero's globe artifact, seeded by the camox plugin's dev-only `afterSync`
 * hook. The source lives in a file, like one an agent would push with `--field-file`.
 */
const GLOBE_SOURCE = new URL("./artifacts/globe.html", import.meta.url);

/** The page and block endpoints the seeder needs, as exposed by the plugin's authed API client. */
export interface HeroGlobeContext {
  projectSlug: string;
  logger: { info: (message: string) => void };
  client: {
    pages: {
      getByPath: (input: {
        projectSlug: string;
        path: string;
        source: "draft";
      }) => Promise<{ blocks: readonly { id: number; type: string; content: unknown }[] }>;
    };
    blocks: {
      updateContent: (input: { id: number; content: unknown }) => Promise<unknown>;
    };
  };
}

/** Fills empty globes on the home page's heroes; a globe that has a source is left alone. */
export async function seedHeroGlobe({ client, projectSlug, logger }: HeroGlobeContext) {
  const page = await client.pages.getByPath({ projectSlug, path: "/", source: "draft" });
  const heroes = page.blocks.filter(
    (block) => block.type === "hero" && !(block.content as { globe?: unknown } | null)?.globe,
  );
  if (heroes.length === 0) return;

  const source = await readFile(GLOBE_SOURCE, "utf-8");
  for (const hero of heroes) {
    await client.blocks.updateContent({ id: hero.id, content: { globe: source } });
  }

  logger.info(`[playground] Seeded the globe artifact in ${heroes.length} home page hero(es)`);
}
