import { ICON_CATALOG_VERSION, scopeIconSvgIds, type IconSvgData } from "@camox/api-contract";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { useId, type SVGProps } from "react";

declare const __CAMOX_API_URL__: string;

export const iconQuery = (id: string) => ({
  queryKey: ["camox-icon", ICON_CATALOG_VERSION, id],
  staleTime: Infinity,
  queryFn: async (): Promise<IconSvgData> => {
    if (!/^[a-z0-9-]+:[a-z0-9-]+$/.test(id)) throw new Error("Invalid icon ID");
    const response = await fetch(
      `${__CAMOX_API_URL__}/icons/${ICON_CATALOG_VERSION}/${id.replace(":", "/")}`,
    );
    if (!response.ok) throw new Error(`Unable to resolve icon ${id}`);
    return response.json();
  },
});

export type IconProps = Omit<
  SVGProps<SVGSVGElement>,
  "children" | "dangerouslySetInnerHTML" | "name"
>;
export function IconSvg({ iconId, ...props }: IconProps & { iconId: string }) {
  const { data } = useQuery(iconQuery(iconId));
  const instance = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const body = scopeIconSvgIds(data?.body ?? "", `camox-${instance}-`);
  const labeled = !!(props["aria-label"] || props["aria-labelledby"]);
  return (
    <svg
      {...data?.attributes}
      aria-hidden={labeled ? undefined : true}
      role={labeled ? "img" : undefined}
      focusable="false"
      data-icon-license={data?.attribution?.url ?? data?.attribution?.license}
      data-icon-author={data?.attribution?.author}
      {...props}
      dangerouslySetInnerHTML={{ __html: body }}
    />
  );
}

export async function prefetchIcons(client: QueryClient, ...sources: unknown[]) {
  const ids = new Set<string>();
  const allowed = new Set<string>();
  const collectSchemas = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const schema = value as { fieldType?: string; enum?: unknown };
    if (schema.fieldType === "Icon" && Array.isArray(schema.enum)) {
      for (const id of schema.enum) if (typeof id === "string") allowed.add(id);
      return;
    }
    Object.values(value).forEach(collectSchemas);
  };
  sources.forEach(collectSchemas);
  const walk = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      // Schemas contain the whole ID list, not selected content.
      if (key === "enum") continue;
      if (typeof child === "string" && allowed.has(child)) ids.add(child);
      else walk(child);
    }
  };
  sources.forEach(walk);
  await Promise.all([...ids].map((id) => client.fetchQuery(iconQuery(id))));
}
