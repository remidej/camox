import {
  createSchemaOrgGraph,
  defineBreadcrumb,
  defineOrganization,
  defineWebPage,
  defineWebSite,
} from "@unhead/schema-org";

/**
 * Structured Data: the JSON-LD graph in each page's head. The runtime assembles it with
 * `@unhead/schema-org` from what Camox knows about the website and the page.
 *
 * To grow the graph, add what it's built from to `PageGraphInput` and the nodes it gives to
 * `graphNodes`: the site's nodes come from `siteNodes`, the page's from `pageNode`.
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
  /** Where the page sits in the website, from the home page down to the page itself. */
  breadcrumb?: ReadonlyArray<{ name: string; url: string }>;
}

/** What a page's graph is built from. */
export interface PageGraphInput {
  site: SiteGraphInput;
  page: PageNodeInput;
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

/** The page's own node, part of the WebSite. */
function pageNode(page: PageNodeInput, site: SiteGraphInput) {
  return defineWebPage({
    "@type": "WebPage",
    "@id": `${page.url}#webpage`,
    url: page.url,
    name: page.name,
    ...(page.description && { description: page.description }),
    inLanguage: page.inLanguage,
    isPartOf: { "@id": siteNodeIds(site.url).website },
    ...(page.image && { primaryImageOfPage: { url: page.image } }),
    ...(page.datePublished && { datePublished: page.datePublished.toISOString() }),
    ...(page.dateModified && { dateModified: page.dateModified.toISOString() }),
  });
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

/** Every node a page's graph holds, before they are resolved and linked. */
function graphNodes(input: PageGraphInput) {
  return [
    ...siteNodes(input.site, input.page.inLanguage),
    pageNode(input.page, input.site),
    ...breadcrumbNodes(input.page),
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
