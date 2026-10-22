import { isPageUrlMarker, type PageUrlMarker } from "@camox/api-contract";
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

/** What a page's graph is built from. */
export interface PageGraphInput {
  site: SiteGraphInput;
  page: PageNodeInput;
  /** What the page's layout says the page is. */
  declared?: LayoutStructuredData;
  /** The nodes of the blocks on the page, its layout's included, in the order they're placed. */
  blocks?: readonly PlacedBlockNodes[];
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

/** The page's own node, part of the WebSite, of the kind its layout says, or a plain WebPage. */
function pageNode(page: PageNodeInput, site: SiteGraphInput, declared?: LayoutStructuredData) {
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
    ...(declared && !kind && { mainEntity: { "@id": pageNodeIds(page.url).mainEntity } }),
  });
}

/**
 * The thing a page is about, as its own node, filled from the page where its layout leaves
 * properties out: its name or headline, description, URL and image for every type, and its
 * dates, publisher and language for creative works.
 */
function mainEntityNode(entity: MainEntity, page: PageNodeInput, site: SiteGraphInput) {
  const work = isCreativeWork(entity);
  return {
    ...(isArticle(entity) ? { headline: page.name } : { name: page.name }),
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
    "@id": pageNodeIds(page.url).mainEntity,
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

/** Every node a page's graph holds, before they are resolved and linked. */
function graphNodes({ site, page, declared, blocks }: PageGraphInput) {
  return [
    ...siteNodes(site, page.inLanguage),
    pageNode(page, site, declared),
    ...(declared && !isWebPageKind(declared) ? [mainEntityNode(declared, page, site)] : []),
    ...breadcrumbNodes(page),
    ...blockNodes(page, blocks),
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
