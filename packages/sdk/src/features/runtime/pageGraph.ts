import type { RecordStructuredData } from "@camox/api-contract";

import type { CamoxApp } from "../../core/createApp";
import { curatedPageTitle } from "../../core/layoutContext";
import type { RecordPageStructuredData } from "../../core/requestContext";
import type { LayoutStructuredData } from "../../core/structuredData";
import type { LocaleView } from "../../lib/locale-path";
import {
  curatedPageMetaInput,
  declarePage,
  type PageHead,
  type PageStructure,
} from "../routes/pageRuntime";
import {
  buildPageGraph,
  type PlacedBlockNodes,
  type RecordGraphInput,
  serializeStructuredData,
  type SiteGraphInput,
} from "./structuredData";

// What a page's Structured Data is assembled from beyond its head, and the head with its graph.

/**
 * What a page's Structured Data says beyond its head: its project, its undecorated title, when
 * it was published, and what its layout says it is.
 */
export interface PageDescription {
  project: {
    id: number;
    name: string;
    updatedAt: number | string;
    /** Absent from APIs older than the social profiles Project Setting. */
    socialProfiles?: readonly string[];
  };
  /** The page's undecorated title, which names its own crumb. */
  title: string;
  /** The page's first and last publish times on Live, in milliseconds. */
  published?: { first?: number | null; last?: number | null };
  declared?: LayoutStructuredData;
  /**
   * The nodes of the blocks on the page, in the order they're placed, as the API evaluates them:
   * links to pages are still markers.
   */
  blocks?: readonly PlacedBlockNodes[];
  /** The records the page's graph can hold, whose `@id`s depend on the website's address. */
  records?: Omit<RecordGraphInput, "id">;
}

/**
 * The records a page's graph can hold: those its blocks reference, and on a record page, the
 * page's record and those it references.
 */
export function pageRecords(
  /** Absent from APIs older than records' Structured Data. */
  blocks: RecordStructuredData | undefined,
  page?: { id: string; structuredData?: RecordPageStructuredData; titles?: Record<string, string> },
): Omit<RecordGraphInput, "id"> {
  const own = page?.structuredData;
  return {
    nodes: {
      ...blocks?.nodes,
      ...own?.records.nodes,
      ...(page && own?.node && { [page.id]: own.node }),
    },
    referenced: [...new Set([...(blocks?.referenced ?? []), ...(own?.records.referenced ?? [])])],
    ...(page?.titles && { titles: page.titles }),
    ...(page && { main: page.id }),
  };
}

/** Each placed block's nodes, its layout's before and after the page's own. */
export function placedBlockNodes(
  layout: { beforeBlockIds: readonly string[]; afterBlockIds: readonly string[] } | null,
  pageBlockIds: readonly string[],
  /** Absent from APIs older than blocks' Structured Data. */
  structuredData: Readonly<Record<string, ReadonlyArray<Record<string, unknown>>>> | undefined,
): PlacedBlockNodes[] {
  if (!structuredData) return [];
  const ids = [
    ...(layout?.beforeBlockIds ?? []),
    ...pageBlockIds,
    ...(layout?.afterBlockIds ?? []),
  ];
  return ids.flatMap((id) => {
    const nodes = structuredData?.[id];
    return nodes?.length ? [{ id, nodes }] : [];
  });
}

/** What a curated page's Structured Data says beyond its head. */
export function curatedPageDescription(
  camoxApp: CamoxApp | undefined,
  structure: PageStructure,
  locale: LocaleView,
): PageDescription {
  const { page, project, projectName } = structure;
  return {
    project: { ...project, name: projectName },
    title: curatedPageTitle(page),
    published: { first: page.firstPublishedAt, last: page.publishedAt },
    declared: declarePage(curatedPageMetaInput(camoxApp, structure, locale)),
    blocks: placedBlockNodes(structure.layout, page.blockIds, structure.structuredData),
    records: pageRecords(structure.recordStructuredData),
  };
}

/** The value of a head's meta tag, by its name or property. */
function headMeta(head: PageHead, key: string): string | undefined {
  return head.meta?.find((entry) => entry.name === key || entry.property === key)?.content;
}

/**
 * A page's head with its Structured Data, which names and describes the page as the head does,
 * with the head's page image.
 */
export function withStructuredData(
  head: PageHead,
  place: { url: string; locale: string },
  site: SiteGraphInput,
  {
    published,
    declared,
    breadcrumb,
    blocks,
    records,
  }: Omit<PageDescription, "records"> & {
    breadcrumb: ReadonlyArray<{ name: string; url: string }>;
    records?: RecordGraphInput;
  },
): PageHead {
  const name = head.meta?.find((entry) => entry.title)?.title ?? "";
  const graph = buildPageGraph({
    site,
    page: {
      url: place.url,
      name,
      description: headMeta(head, "description"),
      inLanguage: place.locale,
      image: headMeta(head, "og:image"),
      ...(published?.first && { datePublished: new Date(published.first) }),
      ...(published?.last && { dateModified: new Date(published.last) }),
      breadcrumb,
    },
    declared,
    blocks,
    records,
  });
  return {
    ...head,
    scripts: [
      ...(head.scripts ?? []),
      { type: "application/ld+json", text: serializeStructuredData(graph) },
    ],
  };
}
