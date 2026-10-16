import type { IconifyJSON } from "@iconify/types";
import { getIconData, iconToSVG } from "@iconify/utils";

import { ICON_CATALOG_VERSION, type IconSvgData } from "./icons.ts";

// Kept out of the root entry so `@iconify/utils` never reaches client bundles.
const collections = new Map<string, Promise<IconifyJSON>>();

export async function loadIconCollection(prefix: string): Promise<IconifyJSON> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(prefix)) throw new Error("Invalid icon collection");
  const existing = collections.get(prefix);
  if (existing) return existing;
  const pending = (async () => {
    const response = await fetch(
      `https://unpkg.com/@iconify/json@${ICON_CATALOG_VERSION}/json/${prefix}.json`,
      { signal: AbortSignal.timeout(30_000) },
    );
    if (!response.ok) throw new Error(`Unable to load icon collection ${prefix}`);
    const data = (await response.json()) as IconifyJSON;
    if (data.prefix !== prefix || !data.icons || !data.info?.license)
      throw new Error("Invalid icon catalog or missing license");
    return data;
  })();
  collections.set(prefix, pending);
  // Bound worker memory; failed fetches must be retryable.
  if (collections.size > 8) collections.delete(collections.keys().next().value!);
  try {
    return await pending;
  } catch (error) {
    collections.delete(prefix);
    throw error;
  }
}

export function iconCollectionIds(data: IconifyJSON): string[] {
  return [...Object.keys(data.icons), ...Object.keys(data.aliases ?? {})]
    .filter((name) => getIconData(data, name) !== null)
    .sort()
    .map((name) => `${data.prefix}:${name}`);
}

export function resolveIconSvg(data: IconifyJSON, id: string): IconSvgData {
  const [prefix, name, extra] = id.split(":");
  if (prefix !== data.prefix || !name || extra !== undefined) throw new Error("Invalid icon ID");
  const icon = getIconData(data, name);
  if (!icon) throw new Error(`Unknown icon: ${id}`);
  const svg = iconToSVG(icon);
  return {
    body: svg.body,
    attributes: svg.attributes,
    attribution: data.info
      ? {
          collection: data.info.name,
          author: data.info.author.name,
          license: data.info.license.title,
          url: data.info.license.url,
        }
      : undefined,
  };
}
