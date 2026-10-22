import { isPageUrlMarker, linkedRecordId, type PageUrlMarker } from "@camox/api-contract";
import {
  createSchemaOrgGraph,
  defineBreadcrumb,
  defineOrganization,
  defineWebPage,
  defineWebSite,
} from "@unhead/schema-org";

import {
  isArticle,
  isCreativeWork,
  isWebPageKind,
  type LayoutStructuredData,
  type MainEntity,
  type WebPageKind,
} from "../../core/structuredData";

/**
 * Structured Data: the JSON-LD graph in each page's head. The runtime assembles it with
 * `@unhead/schema-org` from what Camox knows about the website and the page.
 *
 * To grow the graph, add what it's built from to `PageGraphInput` and the nodes it gives to
 * `graphNodes`: the site's nodes come from `siteNodes`, the page's from `pageNode`, the
 * layout's main entity from `mainEntityNode`, and blocks' nodes from `blockNodes`. Definitions' nodes are typed by Camox's vocabulary,
 * in `core/structuredData`.
 */

/** The website, the same on every page of a locale. */
export interface SiteGraphInput {
  /** The website's address: its home, with the runtime's base path. */
  url: string;
  /** The project's name. */
  name: string;
  /** The project's logo, a PNG. */
  logo: { url: string; width: number; height: number };
  /** The project's social profile URLs, in their order. */
  socialProfiles: readonly string[];
}

/** The page a graph describes, as its head does. */
export interface PageNodeInput {
  /** Its canonical URL. */
  url: string;
  /** The head's title. */
  name: string;
  /** The head's description. */
  description?: string;
  /** Its locale's tag. */
  inLanguage: string;
  /** The page image's URL, as `og:image` names it. */
  image?: string;
  /** When the page was first published to Live. */
  datePublished?: Date;
  /** When the page was last published to Live. */
  dateModified?: Date;
  /** Where the page sits in the website, from the home page down to the page itself. */
  breadcrumb?: ReadonlyArray<{ name: string; url: string }>;
}

/** A placed block's nodes, as its template describes the things it shows. */
export interface PlacedBlockNodes {
  /** The block's id, which tells its placement's nodes apart from another's. */
  id: string;
  nodes: ReadonlyArray<Record<string, unknown>>;
}

/**
 * The collection records a page's graph can hold. Nodes link records by record links, which the
 * graph turns into `@id`s; a record's node is in the graph once some node links it.
 */
export interface RecordGraphInput {
  /** Each record's node, by record id, as the API evaluates it. */
  nodes: Readonly<Record<string, Record<string, unknown>>>;
  /** The records the page's content references: its `mentions`, unless a node links them. */
  referenced: readonly string[];
  /** Titles of records without nodes, by id: what links to them read as. */
  titles?: Readonly<Record<string, string>>;
  /** The record a record page renders: the page's main entity when its layout declares none. */
  main?: string;
  /** A record's `@id`, from its id. */
  id: (recordId: string) => string;
}

/** What a page's graph is built from. */
export interface PageGraphInput {
  site: SiteGraphInput;
  page: PageNodeInput;
  /** What the page's layout says the page is. */
  declared?: LayoutStructuredData;
  /** The nodes of the blocks on the page, its layout's included, in the order they're placed. */
  blocks?: readonly PlacedBlockNodes[];
  records?: RecordGraphInput;
}

/**
 * A value of a node the API evaluated, with the absolute URL of each page its markers name.
 * Only the runtime knows the website's address.
 */
export function withPageUrls<T>(value: T, pageUrl: (marker: PageUrlMarker) => string): T {
  if (isPageUrlMarker(value)) return pageUrl(value) as T;
  if (Array.isArray(value)) return value.map((entry) => withPageUrls(entry, pageUrl)) as T;
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, withPageUrls(entry, pageUrl)]),
    ) as T;
  }
  return value;
}

/** A JSON-LD document holding one graph. */
export interface StructuredData {
  "@context": "https://schema.org";
  "@graph": Array<Record<string, unknown>>;
}

/** The `@id`s of the site's nodes, derived from the website's address. */
export function siteNodeIds(siteUrl: string) {
  return { organization: `${siteUrl}#identity`, website: `${siteUrl}#website` };
}

/** The Organization publishing the website, and the WebSite itself. */
function siteNodes(site: SiteGraphInput, inLanguage: string) {
  const ids = siteNodeIds(site.url);
  return [
    defineOrganization({
      "@id": ids.organization,
      name: site.name,
      url: site.url,
      logo: { url: site.logo.url, width: site.logo.width, height: site.logo.height },
      ...(site.socialProfiles.length > 0 && { sameAs: [...site.socialProfiles] }),
    }),
    defineWebSite({
      "@id": ids.website,
      name: site.name,
      url: site.url,
      inLanguage,
      publisher: { "@id": ids.organization },
    }),
  ];
}

/** The `@id`s of a page's nodes, derived from its URL. */
function pageNodeIds(pageUrl: string) {
  return { page: `${pageUrl}#webpage`, mainEntity: `${pageUrl}#main-entity` };
}

/**
 * The page's own node, part of the WebSite, of the kind its layout says, or a plain WebPage,
 * linking its main entity and the records it mentions.
 */
function pageNode(
  page: PageNodeInput,
  site: SiteGraphInput,
  declared: LayoutStructuredData | undefined,
  { mainEntity, mentions }: { mainEntity?: string; mentions: readonly string[] },
) {
  const kind: WebPageKind | undefined = declared && isWebPageKind(declared) ? declared : undefined;
  return defineWebPage({
    ...kind,
    "@type": kind?.["@type"] ?? "WebPage",
    "@id": pageNodeIds(page.url).page,
    url: page.url,
    name: page.name,
    ...(page.description && { description: page.description }),
    inLanguage: page.inLanguage,
    isPartOf: { "@id": siteNodeIds(site.url).website },
    ...(page.image && { primaryImageOfPage: { url: page.image } }),
    ...(page.datePublished && { datePublished: page.datePublished.toISOString() }),
    ...(page.dateModified && { dateModified: page.dateModified.toISOString() }),
    ...(mainEntity && { mainEntity: { "@id": mainEntity } }),
    ...(mentions.length > 0 && { mentions: mentions.map((id) => ({ "@id": id })) }),
  });
}

/**
 * The thing a page is about, as its own node, filled from the page where its layout leaves
 * properties out: its name or headline, description, URL and image for every type, and its
 * dates, publisher and language for creative works.
 */
function mainEntityNode(
  entity: MainEntity | Record<string, unknown>,
  page: PageNodeInput,
  site: SiteGraphInput,
  id: string,
) {
  const work = isCreativeWork(entity as { "@type": string });
  return {
    ...(isArticle(entity as { "@type": string }) ? { headline: page.name } : { name: page.name }),
    ...(page.description && { description: page.description }),
    url: page.url,
    ...(page.image && { image: page.image }),
    ...(work && {
      ...(page.datePublished && { datePublished: page.datePublished.toISOString() }),
      ...(page.dateModified && { dateModified: page.dateModified.toISOString() }),
      publisher: { "@id": siteNodeIds(site.url).organization },
      inLanguage: page.inLanguage,
    }),
    ...entity,
    "@id": id,
    mainEntityOfPage: { "@id": pageNodeIds(page.url).page },
  };
}

/** The page's breadcrumb, which the page node links. None for a page without crumbs. */
function breadcrumbNodes(page: PageNodeInput) {
  if (!page.breadcrumb?.length) return [];
  return [
    defineBreadcrumb({
      "@id": `${page.url}#breadcrumb`,
      itemListElement: page.breadcrumb.map((crumb) => ({ name: crumb.name, item: crumb.url })),
    }),
  ];
}

/**
 * The things the page's blocks show, each its own node, linked to the page: creative works are
 * part of it, and it is about anything else. Every placement's nodes have their own `@id`s.
 */
function blockNodes(page: PageNodeInput, blocks: readonly PlacedBlockNodes[] = []) {
  const pageId = { "@id": pageNodeIds(page.url).page };
  return blocks.flatMap(({ id, nodes }) =>
    nodes.map((node, index) => ({
      ...node,
      "@id": `${page.url}#block-${id}-${index}`,
      [isCreativeWork(node as { "@type": string }) ? "isPartOf" : "subjectOf"]: pageId,
    })),
  );
}

/**
 * The records a graph places: links to records with nodes become their `@id`s and place the
 * records, and links to records without nodes read as their titles, or are left out.
 */
function recordPlacement(records: RecordGraphInput | undefined) {
  const placed = new Set<string>();
  const pending: string[] = [];
  const place = (id: string) => {
    if (placed.has(id)) return;
    placed.add(id);
    pending.push(id);
  };
  const link = (value: unknown): unknown => {
    const id = linkedRecordId(value);
    if (id !== undefined) {
      if (!records?.nodes[id]) return records?.titles?.[id];
      place(id);
      return { "@id": records.id(id) };
    }
    if (Array.isArray(value)) return value.map(link).filter((entry) => entry !== undefined);
    if (typeof value === "object" && value !== null) {
      return Object.fromEntries(
        Object.entries(value).flatMap(([key, entry]) => {
          const linked = link(entry);
          return linked === undefined ? [] : [[key, linked]];
        }),
      );
    }
    return value;
  };
  return {
    placed,
    place,
    /** A value with its links resolved. */
    link: <T>(value: T) => link(value) as T,
    /** The nodes of the records placed since last asked, and of those they link in turn. */
    nodes: () => {
      const nodes: Array<Record<string, unknown>> = [];
      for (let id = pending.shift(); id !== undefined; id = pending.shift()) {
        const { "@id": _own, ...node } = records!.nodes[id]!;
        nodes.push({ ...(link(node) as Record<string, unknown>), "@id": records!.id(id) });
      }
      return nodes;
    },
  };
}

/** Every node a page's graph holds, before they are resolved and linked. */
function graphNodes({ site, page, declared, blocks, records }: PageGraphInput) {
  const placement = recordPlacement(records);
  const linked = declared && placement.link(declared);
  const blockList = blockNodes(page, blocks).map(placement.link);
  // A record page's record is its main entity when its layout declares none.
  const mainRecord = !declared && records?.main && records.nodes[records.main] && records.main;
  let mainEntity: Record<string, unknown> | undefined;
  if (linked && !isWebPageKind(linked)) {
    mainEntity = mainEntityNode(linked, page, site, pageNodeIds(page.url).mainEntity);
  }
  if (mainRecord) placement.place(mainRecord);
  const placedRecords = placement.nodes();
  if (mainRecord) {
    const index = placedRecords.findIndex((node) => node["@id"] === records!.id(mainRecord));
    const [node] = placedRecords.splice(index, 1);
    mainEntity = mainEntityNode(node!, page, site, records!.id(mainRecord));
  }
  // What the content references but no node links, the page mentions.
  const mentions = (records?.referenced ?? []).filter(
    (id) => records!.nodes[id] && !placement.placed.has(id),
  );
  for (const id of mentions) placement.place(id);
  const recordNodes = [...placedRecords, ...placement.nodes()];
  return [
    ...siteNodes(site, page.inLanguage),
    pageNode(page, site, linked, {
      mainEntity: mainEntity?.["@id"] as string | undefined,
      mentions: mentions.map((id) => records!.id(id)),
    }),
    ...(mainEntity ? [mainEntity] : []),
    ...breadcrumbNodes(page),
    ...blockList,
    ...recordNodes,
  ];
}

/** A page's graph, resolved into JSON-LD. */
export function buildPageGraph(input: PageGraphInput): StructuredData {
  const graph = createSchemaOrgGraph();
  graph.push(graphNodes(input) as never);
  const nodes = graph.resolveGraph({
    host: input.site.url,
    url: input.page.url,
    inLanguage: input.page.inLanguage,
  });
  return { "@context": "https://schema.org", "@graph": nodes as StructuredData["@graph"] };
}

/** JSON-LD as a script's text: `<` is escaped, so content can't close the script. */
export function serializeStructuredData(data: StructuredData): string {
  return JSON.stringify(data).replaceAll("<", "\\u003c");
}
