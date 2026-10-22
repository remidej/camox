import {
  createSchemaOrgGraph,
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
 * `graphNodes`: the site's nodes come from `siteNodes`, the page's from `pageNode`, and the
 * layout's main entity from `mainEntityNode`. Definitions' nodes are typed by Camox's vocabulary,
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
}

/** What a page's graph is built from. */
export interface PageGraphInput {
  site: SiteGraphInput;
  page: PageNodeInput;
  /** What the page's layout says the page is. */
  declared?: LayoutStructuredData;
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

/** Every node a page's graph holds, before they are resolved and linked. */
function graphNodes({ site, page, declared }: PageGraphInput) {
  return [
    ...siteNodes(site, page.inLanguage),
    pageNode(page, site, declared),
    ...(declared && !isWebPageKind(declared) ? [mainEntityNode(declared, page, site)] : []),
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
