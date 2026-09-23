import {
  ICON_CATALOG_VERSION,
  loadIconCollection,
  iconCollectionIds,
  resolveIconSvg,
} from "@camox/api-contract";
import { Hono } from "hono";

export const iconRoutes = new Hono();
iconRoutes.get("/:version/:prefix/:name", async (c) => {
  if (c.req.param("version") !== ICON_CATALOG_VERSION) return c.notFound();
  const prefix = c.req.param("prefix");
  const name = c.req.param("name");
  if (!/^[a-z0-9-]+$/.test(prefix) || !/^(?:[a-z0-9-]+|_catalog)$/.test(name)) return c.notFound();
  const data = await loadIconCollection(prefix);
  c.header("Cache-Control", "public, max-age=31536000, immutable");
  if (name === "_catalog")
    return c.json({ ids: iconCollectionIds(data), license: data.info!.license });
  if (!Object.hasOwn(data.icons, name) && !Object.hasOwn(data.aliases ?? {}, name))
    return c.notFound();
  return c.json(resolveIconSvg(data, `${prefix}:${name}`));
});
