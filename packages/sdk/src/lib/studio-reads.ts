import {
  inScope,
  queryKeys,
  scopeOfKey,
  type InvalidationMessage,
  type QueryKey,
} from "@camox/api-contract/query-keys";
import {
  type QueryClient,
  useQueries,
  useQuery,
  type UseQueryResult,
  useSuspenseQuery,
} from "@tanstack/react-query";
import * as React from "react";

import type { AnyLayoutLoaderResult } from "../core/createLayout";
import { fetchRuntimeJson } from "../features/runtime/navigationTarget";
import type { PageRenderInput } from "../features/runtime/runtime";
import type { ApiClient } from "./api-client";
import { type DraftScope, useCurrentDraftId } from "./draft-scope";
import type { LocaleView } from "./locale-path";
import { collectFileIds } from "./normalized-data";
import type {
  BlockBundle,
  BlockDefinitionRow,
  CollectionDefinition,
  CollectionRecord,
  DraftList,
  DraftSummary,
  File,
  Layout,
  MissingFromLocale,
  Page,
  PageStructure,
  PageWithBlocks,
  Project,
} from "./queries";
import { ViewLocaleContext } from "./view-locale-context";

/**
 * The studio's reads (ADR 0011): every query the studio caches is one entry here, which owns its
 * key, the draft it reads, how it fetches, how long it stays fresh, and the reads its response
 * fills in. Callers name a read, `reads.blockBundle(id)`, and never build a key.
 *
 * A read's key is an API broadcast prefix (`@camox/api-contract/query-keys`) with the scope
 * appended, so realtime reaches every read. A fetch reads the draft its key names, never the one
 * the studio moved to since, so a key never holds another draft's data.
 */

/** One read of the studio: an entry and what identifies it. Opaque to callers. */
export interface Read<T, R = T> {
  readonly entry: ReadEntry<any, any, any>;
  readonly params: unknown;
  /** What the read holds and what a full response is, for types only. */
  readonly __types?: { value: T; response: R };
}

/**
 * What a read's fetch gets: the draft and locale its key names, and the transports to read it
 * through.
 */
interface FetchContext {
  draft: string | null;
  /** A client whose reads name the draft and locale the key names. */
  api: ApiClient;
  /** A client whose reads name another draft, for shared reads about one draft. */
  apiIn: (draft: string | null) => ApiClient;
  signal: AbortSignal;
  /** Reads the runtime's JSON endpoints, in the locale the key names. */
  runtimeJson: (
    endpoint: string,
    runtimeBasePath: string,
    params: Record<string, string>,
    draft: string | null,
    signal: AbortSignal,
  ) => Promise<Response>;
  /** Stores what a response says about other reads, in the same draft. */
  fill: <V>(read: Read<V>, value: V) => void;
}

/**
 * Reads one of the runtime's JSON endpoints in `draft` and `locale` (the default locale without
 * it), relative to `runtimeBasePath`.
 */
export type RuntimeJson = (
  endpoint: string,
  runtimeBasePath: string,
  params: Record<string, string>,
  draft: string | null,
  signal: AbortSignal,
  locale?: LocaleView,
) => Promise<Response>;

interface EntryDefinition<P, T, R> {
  /** The key without its scope, under the prefix the API broadcasts for it. */
  key: (params: P) => QueryKey;
  /**
   * A shared read's key names no scope nor locale: it's the same in every draft, or it's about
   * the draft its params name.
   */
  shared?: boolean;
  /** A read the same in every locale: its key names no locale. */
  everyLocale?: boolean;
  /** The light fetch a refetch uses. */
  fetch: (context: FetchContext, params: P) => Promise<T>;
  /** A full response this read can be filled from, and the other reads it fills in. */
  full?: {
    load: (context: FetchContext, params: P) => Promise<R>;
    land: (response: R, fill: FetchContext["fill"], params: P) => T;
  };
  /**
   * Decodes the params from a key as `key` builds it, without its locale and scope, for reads
   * matched in a dehydrated cache.
   */
  parse?: (key: readonly unknown[]) => P | null;
  staleTime?: number;
  retry?: boolean;
  refetchOnWindowFocus?: boolean;
}

export type ReadEntry<P, T, R = T> = ((params: P) => Read<T, R>) & {
  readonly definition: EntryDefinition<P, T, R>;
  /** The params of a key this entry built, or null for another read's key. */
  paramsOf: (key: readonly unknown[]) => P | null;
};

function entry<P, T, R = T>(definition: EntryDefinition<P, T, R>): ReadEntry<P, T, R> {
  const make = ((params: P) => ({ entry: make, params })) as ReadEntry<P, T, R>;
  Object.assign(make, {
    definition,
    paramsOf: (key: readonly unknown[]) =>
      definition.parse?.(key.slice(0, key.length - keySuffixLength(definition))) ?? null,
  });
  return make;
}

type LayoutRead = Awaited<ReturnType<ApiClient["layouts"]["get"]>>;
/** A layout's structure: its blocks before and after the content of its pages. */
export type LayoutStructure = LayoutRead["layout"];

const usageCountsPrefix = queryKeys.blocks.getUsageCounts;
const collectionsPrefix = ["camox", "collections"] satisfies QueryKey;
// Only a definition sync changes it, and it refreshes everything its scope reads.
const blockDefinitionsPrefix = ["camox", "blockDefinitions", "list"] satisfies QueryKey;

type LayoutStructureParams = { projectUuid: string; layoutId: string };
const loadLayout = (
  { api, signal }: FetchContext,
  { projectUuid, layoutId }: LayoutStructureParams,
) => api.layouts.get({ projectUuid, layoutId }, { signal });
const landLayout = (layout: LayoutRead, fill: FetchContext["fill"]) => {
  fillBlocks(layout, fill);
  return layout.layout;
};

export const reads = {
  /** The project, the same in every draft. */
  project: entry<{ projectUuid: string }, Project>({
    key: ({ projectUuid }) => ["camox", "projects", "getByUuid", projectUuid],
    shared: true,
    fetch: ({ api, signal }, { projectUuid }) =>
      api.projects.getByUuid({ projectUuid }, { signal }),
    staleTime: Infinity,
  }),

  /**
   * The locales the draft reads, or Live's: the default locale first. Adding or removing one
   * refreshes every read of its scope, this one included.
   */
  localeList: entry<{ projectId: number }, LocaleView[]>({
    key: ({ projectId }) => ["camox", "locales", "list", projectId],
    everyLocale: true,
    fetch: ({ api, signal }, { projectId }) => api.locales.list({ projectId }, { signal }),
    staleTime: Infinity,
  }),

  /** The pages and records deleted from the locale viewed, which members add back to it. */
  missingFromLocale: entry<{ projectId: number }, MissingFromLocale>({
    key: ({ projectId }) => ["camox", "locales", "listMissing", projectId],
    fetch: ({ api, signal }, { projectId }) => api.locales.listMissing({ projectId }, { signal }),
  }),

  pageList: entry<{ projectUuid: string }, Page[]>({
    key: () => queryKeys.pages.list,
    fetch: async ({ api, signal }, { projectUuid }) =>
      (await api.pages.listBySlug({ projectUuid }, { signal })).pages,
    staleTime: Infinity,
  }),

  /**
   * A page's structure, without its blocks. Loaded in full, its blocks, files and the records
   * they link fill in their own reads; a refetch reads the structure alone.
   */
  pageStructure: entry<{ path: string; projectUuid: string }, PageStructure, PageWithBlocks>({
    key: ({ path }) => queryKeys.pages.getByPath(path),
    fetch: ({ api, signal }, { path, projectUuid }) =>
      api.pages.getStructure({ path, projectUuid }, { signal }),
    full: {
      load: ({ api, signal }, { path, projectUuid }) =>
        api.pages.getByPath({ path, projectUuid }, { signal }),
      land: (page, fill) => {
        fillBlocks(page, fill);
        return {
          page: page.page,
          layout: page.layout,
          projectName: page.projectName,
          project: page.project,
          structuredData: page.structuredData,
          recordStructuredData: page.recordStructuredData,
        };
      },
    },
    staleTime: Infinity,
  }),

  page: entry<{ id: string }, PageDetail>({
    key: ({ id }) => queryKeys.pages.getById(id),
    fetch: ({ api, signal }, { id }) => api.pages.get({ id }, { signal }),
    staleTime: Infinity,
  }),

  /** A layout's structure, for any layout page; its blocks fill in their own reads. */
  layoutStructure: entry<LayoutStructureParams, LayoutStructure, LayoutRead>({
    key: ({ projectUuid, layoutId }) => [...queryKeys.layouts.all, "get", projectUuid, layoutId],
    fetch: async (context, params) => landLayout(await loadLayout(context, params), context.fill),
    full: { load: loadLayout, land: landLayout },
    staleTime: Infinity,
  }),

  layoutList: entry<{ projectId: number }, Layout[]>({
    key: () => [...queryKeys.layouts.all, "list"],
    fetch: ({ api, signal }, { projectId }) => api.layouts.list({ projectId }, { signal }),
    staleTime: Infinity,
  }),

  /** The block definitions the draft reads: its own when it has them, else Live's (ADR 0006). */
  blockDefinitionList: entry<{ projectId: number }, BlockDefinitionRow[]>({
    key: () => blockDefinitionsPrefix,
    fetch: ({ api, signal }, { projectId }) => api.blockDefinitions.list({ projectId }, { signal }),
    staleTime: Infinity,
  }),

  /** A block with its repeatable items and the files they place. */
  blockBundle: entry<string, BlockBundle>({
    key: (id) => queryKeys.blocks.get(id),
    fetch: ({ api, signal }, id) => api.blocks.get({ id }, { signal }),
    // A block bundle's key is its block's prefix; decoding rebuilds it to check.
    parse: (key) => {
      const id = key[3];
      if (typeof id !== "string") return null;
      const rebuilt = queryKeys.blocks.get(id);
      return rebuilt.length === key.length && rebuilt.every((part, index) => part === key[index])
        ? id
        : null;
    },
    staleTime: Infinity,
  }),

  fileList: entry<{ projectId: number }, File[]>({
    key: () => queryKeys.files.list,
    fetch: ({ api, signal }, { projectId }) => api.files.list({ projectId }, { signal }),
    staleTime: Infinity,
  }),

  file: entry<string, File>({
    key: (id) => queryKeys.files.get(id),
    fetch: ({ api, signal }, id) => api.files.get({ id }, { signal }),
    staleTime: Infinity,
  }),

  /** How many placements use a file. Placing or removing content refreshes it. */
  fileUsageCount: entry<string, number>({
    key: (id) => [...usageCountsPrefix, "files", id],
    fetch: async ({ api, signal }, id) => (await api.files.getUsageCount({ id }, { signal })).count,
    staleTime: Infinity,
  }),

  /** How many placements each block definition has, by block type. */
  blockUsageCounts: entry<{ projectId: number }, Record<string, number>>({
    key: () => usageCountsPrefix,
    fetch: async ({ api, signal }, { projectId }) =>
      Object.fromEntries(
        (await api.blocks.getUsageCounts({ projectId }, { signal })).map(({ type, count }) => [
          type,
          count,
        ]),
      ),
    staleTime: Infinity,
  }),

  pageMarkdown: entry<string, string>({
    key: (pageId) => queryKeys.blocks.getPageMarkdown(pageId),
    fetch: async ({ api, signal }, pageId) =>
      (await api.blocks.getPageMarkdown({ pageId }, { signal })).markdown,
    staleTime: Infinity,
  }),

  collectionList: entry<{ projectUuid: string }, CollectionDefinition[]>({
    key: ({ projectUuid }) => [...collectionsPrefix, "list", projectUuid],
    fetch: ({ api, signal }, { projectUuid }) =>
      api.collectionDefinitions.list({ projectUuid }, { signal }),
  }),

  collection: entry<{ projectUuid: string; collectionId: string }, CollectionDetail>({
    key: ({ projectUuid, collectionId }) => [
      ...collectionsPrefix,
      "get",
      projectUuid,
      collectionId,
    ],
    fetch: ({ api, signal }, input) => api.collectionDefinitions.get(input, { signal }),
  }),

  record: entry<{ projectUuid: string; collectionId: string; id: string }, CollectionRecord>({
    key: ({ projectUuid, collectionId, id }) =>
      queryKeys.collections.record(projectUuid, collectionId, id),
    fetch: ({ api, signal }, input) => api.collectionDefinitions.getRecord(input, { signal }),
  }),

  records: entry<{ projectUuid: string; collectionId: string }, CollectionRecords>({
    key: ({ projectUuid, collectionId }) =>
      queryKeys.collections.records(projectUuid, collectionId),
    fetch: ({ api, signal }, input) => api.collectionDefinitions.listRecords(input, { signal }),
  }),

  /** How many blocks, repeatable items and records reference a record. */
  recordUsageCount: entry<{ projectUuid: string; collectionId: string; id: string }, number>({
    key: ({ projectUuid, collectionId, id }) => [
      ...queryKeys.collections.record(projectUuid, collectionId, id),
      "usageCount",
    ],
    fetch: async ({ api, signal }, input) =>
      (await api.collectionDefinitions.getRecordUsageCount(input, { signal })).count,
  }),

  /** Open drafts and Live's latest publish: the same whatever draft the viewer is in. */
  draftList: entry<{ projectId: number }, DraftList>({
    key: ({ projectId }) => [...queryKeys.drafts.list, projectId],
    shared: true,
    fetch: ({ api, signal }, { projectId }) => api.drafts.list({ projectId }, { signal }),
    staleTime: Infinity,
  }),

  /** A draft's name, creator and change count. Its key ends in the draft, like content's. */
  draft: entry<{ projectId: number; draftId: string }, DraftSummary>({
    key: ({ draftId }) => [...queryKeys.drafts.get, draftId],
    shared: true,
    fetch: ({ apiIn, signal }, { projectId, draftId }) =>
      apiIn(draftId).drafts.get({ projectId }, { signal }),
    staleTime: Infinity,
  }),

  /** What publishing a draft will do; refetched whenever asked, since it depends on Live. */
  publishPreview: entry<{ projectId: number; draftId: string }, PublishPreview>({
    key: ({ draftId }) => [...queryKeys.drafts.all, "previewPublish", draftId],
    shared: true,
    fetch: ({ apiIn, signal }, { projectId, draftId }) =>
      apiIn(draftId).drafts.previewPublish({ projectId }, { signal }),
    staleTime: 0,
  }),

  /**
   * A Canvas frame's page, as the runtime renders it. Edits to the page or its layout refresh it;
   * the selected page's sidebar reads it too.
   */
  canvasFrame: entry<CanvasFrameParams, PageRenderInput>({
    key: ({ projectUuid, runtimeBasePath, pathname, derivedLayoutId }) =>
      derivedLayoutId
        ? [
            ...queryKeys.layouts.all,
            "canvas",
            projectUuid,
            runtimeBasePath,
            pathname,
            derivedLayoutId,
          ]
        : [...queryKeys.pages.getByPath(pathname), "canvas", projectUuid, runtimeBasePath],
    fetch: async (context, { runtimeBasePath, pathname, derivedLayoutId }) => {
      const input = await readRender(context, runtimeBasePath, pathname);
      if (!input) throw new Error(`Could not load ${pathname} (404).`);
      validateCanvasFrame(input, pathname, derivedLayoutId);
      return input;
    },
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
  }),

  /** A code-owned page's loader result, which record edits and publication reload. */
  derivedPageData: entry<DerivedPageParams, AnyLayoutLoaderResult | null>({
    key: ({ projectUuid, runtimeBasePath, pathname }) => [
      ...queryKeys.layouts.all,
      "data",
      projectUuid,
      runtimeBasePath,
      pathname,
    ],
    fetch: async (context, { runtimeBasePath, pathname }) =>
      // A record without live content has no page for visitors.
      (await readRender(context, runtimeBasePath, pathname))?.derived?.result ?? null,
    staleTime: Infinity,
  }),

  /**
   * The first page a derived layout's route discovery lists in the read's locale, or with
   * `recordId` the page of that record; null without one. The path is the locale's, after its
   * prefix.
   */
  discoveredPath: entry<
    { projectUuid: string; runtimeBasePath: string; layoutId: string; recordId?: string },
    string | null
  >({
    key: ({ projectUuid, runtimeBasePath, layoutId, recordId }) => [
      ...queryKeys.layouts.all,
      "routes",
      projectUuid,
      runtimeBasePath,
      layoutId,
      ...(recordId ? [recordId] : []),
    ],
    fetch: async ({ runtimeJson, draft, signal }, { runtimeBasePath, layoutId, recordId }) => {
      const response = await runtimeJson(
        "/_camox/routes",
        runtimeBasePath,
        { layoutId, ...(recordId && { recordId }) },
        draft,
        signal,
      );
      if (!response.ok) throw new Error(`Could not discover pages of ${layoutId}.`);
      return ((await response.json()) as { path: string | null }).path;
    },
    staleTime: Infinity,
    retry: false,
  }),
};

type PageDetail = Awaited<ReturnType<ApiClient["pages"]["get"]>>;
type CollectionDetail = Awaited<ReturnType<ApiClient["collectionDefinitions"]["get"]>>;
type CollectionRecords = Awaited<ReturnType<ApiClient["collectionDefinitions"]["listRecords"]>>;
type PublishPreview = Awaited<ReturnType<ApiClient["drafts"]["previewPublish"]>>;

export interface CanvasFrameParams {
  projectUuid: string;
  runtimeBasePath: string;
  pathname: string;
  derivedLayoutId?: string;
}

export interface DerivedPageParams {
  projectUuid: string;
  runtimeBasePath: string;
  pathname: string;
}

/** What the runtime renders at `pathname` in the read's draft, or null where nothing renders. */
async function readRender(
  { runtimeJson, draft, signal }: FetchContext,
  runtimeBasePath: string,
  pathname: string,
): Promise<PageRenderInput | null> {
  const response = await runtimeJson(
    "/_camox/data",
    runtimeBasePath,
    { path: pathname },
    draft,
    signal,
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Could not load ${pathname} (${response.status}).`);
  return (await response.json()) as PageRenderInput;
}

/** Fills each block's bundle, and each file a bundle places, from a page or layout response. */
function fillBlocks(
  response: Pick<PageWithBlocks, "blocks" | "files" | "repeatableItems">,
  fill: FetchContext["fill"],
) {
  const filesById = new Map(response.files.map((file) => [file.id, file]));
  for (const block of response.blocks) {
    const repeatableItems = response.repeatableItems.filter((item) => item.blockId === block.id);
    const files = [...collectFileIds(block, repeatableItems)]
      .map((id) => filesById.get(id))
      .filter((file) => file != null);
    fill(reads.blockBundle(block.id), { block, repeatableItems, files } as BlockBundle);
    for (const file of files) fill(reads.file(file.id), file);
  }
}

/** Whether a runtime response is the page a Canvas frame asked for. */
export function validateCanvasFrame(
  input: Pick<PageRenderInput, "pathname" | "routeKind" | "dehydratedState" | "previewDocument"> & {
    derived?: { layoutId: string };
  },
  pathname: string,
  derivedLayoutId?: string,
) {
  if (
    input.pathname !== pathname ||
    input.routeKind ||
    !input.dehydratedState ||
    !input.previewDocument
  )
    throw new Error("The server did not return a page preview.");
  // Curated routes take precedence over derived routes on the server. Matching
  // the URL pattern alone does not prove this is a page of the derived layout.
  if (derivedLayoutId && input.derived?.layoutId !== derivedLayoutId)
    throw new Error(`This path does not render the selected derived layout (${derivedLayoutId}).`);
}

/* -------------------------------------------------------------------------------------------------
 * The studio cache
 * -----------------------------------------------------------------------------------------------*/

/** The TanStack query options a read builds: its key, fetch and freshness, nothing else. */
export interface ReadQueryOptions<T> {
  queryKey: QueryKey;
  queryFn: (context: { signal: AbortSignal }) => Promise<T>;
  staleTime?: number;
  retry?: boolean;
  refetchOnWindowFocus?: boolean;
}

/**
 * Which draft and locale an operation acts in: the scope's current draft unless `in` names one
 * (null for Live), and the locale the studio views unless `locale` names one.
 */
type InDraft = { in?: string | null; locale?: LocaleView };
/** The draft and locale an operation acts in. */
type Target = { draft: string | null; locale: LocaleView };

/**
 * A locale as a key segment: the tag a request names in `LOCALE_HEADER`, and none for the default
 * locale, which requests don't name. A server render naming no locale keys the default one's.
 */
const localeKey = (locale: LocaleView) => (locale.isDefault ? "" : locale.tag);

/** A read's key in `target`: its own key, then its locale unless it has none, then its scope. */
function keyIn(definition: EntryDefinition<any, any, any>, params: unknown, target: Target) {
  const key = definition.key(params);
  if (definition.shared) return key;
  // The scope stays last: moving between drafts reads and rewrites it there.
  return inScope(definition.everyLocale ? key : [...key, localeKey(target.locale)], target.draft);
}

/** How many segments `keyIn` appends to a read's own key: its locale and scope. */
function keySuffixLength(definition: EntryDefinition<any, any, any>) {
  if (definition.shared) return 0;
  return definition.everyLocale ? 1 : 2;
}

/**
 * The studio's reads, cached for one draft scope: one per browser window and per server request.
 * Every operation acts in the scope's current draft unless `in` names another.
 */
export interface StudioCache {
  /** Query options for a read: for TanStack hooks that the read hooks don't cover. */
  options: <T>(read: Read<T, any>, options?: InDraft) => ReadQueryOptions<T>;
  get: <T>(read: Read<T, any>, options?: InDraft) => T | undefined;
  set: <T>(
    read: Read<T, any>,
    value: T | ((previous: T | undefined) => T | undefined),
    options?: InDraft,
  ) => void;
  /** Stores a full response, as if fetched, and the reads it fills in. Returns what it stored. */
  land: <T, R>(read: Read<T, R>, response: R, options?: InDraft) => T;
  /** The read's value, loading it in full first when absent. Rejects when the load fails. */
  ensure: <T>(read: Read<T, any>, options?: InDraft) => Promise<T>;
  /** Loads the read in full again, whatever the cache holds. Rejects when the load fails. */
  reload: <T>(read: Read<T, any>, options?: InDraft) => Promise<T>;
  /** Marks a read outdated, refetching it if shown. */
  invalidate: (read: Read<any, any>, options?: InDraft) => Promise<void>;
  /** Forgets a read. */
  remove: (read: Read<any, any>, options?: InDraft) => void;
  /** Starts an optimistic change, in the scope's current draft. */
  edit: () => StudioEdit;
  /** Applies a realtime invalidation: a draft's reaches its own reads, Live's every scope's. */
  receive: (message: InvalidationMessage, projectId: number) => Promise<void>;
}

/**
 * An optimistic change. Each read it touches is snapshotted first, and its in-flight fetch
 * cancelled, so a late response can't overwrite the change.
 */
export interface StudioEdit {
  get: <T>(read: Read<T, any>) => T | undefined;
  set: <T>(read: Read<T, any>, value: T | ((previous: T | undefined) => T | undefined)) => void;
  remove: (read: Read<any, any>) => void;
  /** Restores every read it touched as it was, forgetting those that didn't exist. */
  rollback: () => void;
  /** Refetches every read it touched, now that the server has answered. */
  settle: () => void;
}

export interface StudioCacheOptions {
  queryClient: QueryClient;
  scope: DraftScope;
  /** A client whose reads name `draft` (null for Live) and `locale`. */
  api: (draft: string | null, locale: LocaleView) => ApiClient;
  /** Reads the runtime's JSON endpoints. Defaults to the browser's same-origin fetch. */
  runtimeJson?: RuntimeJson;
  /**
   * The locale reads and writes act in, at each operation: the one the studio shows. Without it,
   * the default locale.
   */
  locale?: () => LocaleView;
}

export function createStudioCache({
  queryClient,
  scope,
  api,
  runtimeJson = (endpoint, base, params, draft, signal, locale) =>
    fetchRuntimeJson(scope, endpoint, base, params, draft, signal, locale),
  locale: viewedLocale = scope.locale,
}: StudioCacheOptions): StudioCache {
  const targetOf = (options?: InDraft): Target => ({
    draft: options && "in" in options ? (options.in ?? null) : scope.current(),
    locale: options?.locale ?? viewedLocale(),
  });
  const keyOf = (read: Read<any, any>, target: Target): QueryKey =>
    keyIn(read.entry.definition, read.params, target);
  const contextFor = (target: Target, signal: AbortSignal): FetchContext => ({
    draft: target.draft,
    // Only fetches need a client: landing a response doesn't.
    get api() {
      return api(target.draft, target.locale);
    },
    apiIn: (draft) => api(draft, target.locale),
    signal,
    runtimeJson: (endpoint, base, params, draft, signal) =>
      runtimeJson(endpoint, base, params, draft, signal, target.locale),
    fill: (read, value) => queryClient.setQueryData(keyOf(read, target), value),
  });
  const neverAborted = () => new AbortController().signal;

  const options: StudioCache["options"] = (read, inDraft) => {
    const target = targetOf(inDraft);
    const definition = read.entry.definition;
    const queryKey = keyOf(read, target);
    return {
      queryKey,
      queryFn: ({ signal }) => definition.fetch(contextFor(target, signal), read.params),
      ...(definition.staleTime !== undefined && { staleTime: definition.staleTime }),
      ...(definition.retry !== undefined && { retry: definition.retry }),
      ...(definition.refetchOnWindowFocus !== undefined && {
        refetchOnWindowFocus: definition.refetchOnWindowFocus,
      }),
    };
  };

  const land: StudioCache["land"] = (read, response, inDraft) => {
    const target = targetOf(inDraft);
    const full = read.entry.definition.full;
    if (!full) {
      queryClient.setQueryData(keyOf(read, target), response);
      return response as never;
    }
    const context = contextFor(target, neverAborted());
    const value = full.land(response, context.fill, read.params);
    queryClient.setQueryData(keyOf(read, target), value);
    return value;
  };

  const loadFully = async <T>(read: Read<T, any>, inDraft?: InDraft): Promise<T> => {
    const target = targetOf(inDraft);
    const definition = read.entry.definition;
    const context = contextFor(target, neverAborted());
    if (!definition.full) {
      const value = await definition.fetch(context, read.params);
      queryClient.setQueryData(keyOf(read, target), value);
      return value;
    }
    return land(read, await definition.full.load(context, read.params), {
      in: target.draft,
      locale: target.locale,
    });
  };

  return {
    options,
    get: (read, inDraft) => queryClient.getQueryData(keyOf(read, targetOf(inDraft))),
    set: (read, value, inDraft) =>
      queryClient.setQueryData(keyOf(read, targetOf(inDraft)), value as never),
    land,
    ensure: async (read, inDraft) => {
      const cached = queryClient.getQueryData(keyOf(read, targetOf(inDraft)));
      return cached !== undefined ? (cached as never) : loadFully(read, inDraft);
    },
    reload: loadFully,
    invalidate: (read, inDraft) =>
      queryClient.invalidateQueries({ queryKey: keyOf(read, targetOf(inDraft)), exact: true }),
    remove: (read, inDraft) =>
      queryClient.removeQueries({ queryKey: keyOf(read, targetOf(inDraft)), exact: true }),
    edit: () => {
      const target = targetOf();
      const snapshots = new Map<string, { key: QueryKey; data: unknown }>();
      const touch = (read: Read<any, any>) => {
        const key = keyOf(read, target);
        const hash = JSON.stringify(key);
        if (!snapshots.has(hash)) {
          void queryClient.cancelQueries({ queryKey: key, exact: true });
          snapshots.set(hash, { key, data: queryClient.getQueryData(key) });
        }
        return key;
      };
      return {
        get: (read) => queryClient.getQueryData(keyOf(read, target)),
        set: (read, value) => queryClient.setQueryData(touch(read), value as never),
        remove: (read) => queryClient.removeQueries({ queryKey: touch(read), exact: true }),
        rollback: () => {
          for (const { key, data } of snapshots.values()) {
            if (data === undefined) queryClient.removeQueries({ queryKey: key, exact: true });
            else queryClient.setQueryData(key, data);
          }
        },
        settle: () => {
          for (const { key } of snapshots.values())
            void queryClient.invalidateQueries({ queryKey: key, exact: true });
        },
      };
    },
    receive: async (message, projectId) => {
      const keyScope =
        message.draftId === null ? null : await scope.keyScopeOfDraft(message.draftId, projectId);
      await Promise.all(
        message.targets.map((queryKey) =>
          queryClient.invalidateQueries({
            queryKey,
            // A Live change reaches every draft's reads too: drafts read Live wherever they
            // change nothing.
            predicate:
              keyScope === null ? undefined : (query) => scopeOfKey(query.queryKey) === keyScope,
          }),
        ),
      );
    },
  };
}

export const StudioCacheContext = React.createContext<StudioCache | null>(null);

/** The studio cache of the draft scope the caller is in. */
export function useStudioCache(): StudioCache {
  const cache = React.useContext(StudioCacheContext);
  if (!cache) throw new Error("useStudioCache must be used inside a StudioCacheContext provider");
  return cache;
}

/**
 * The draft and locale the caller's render shows, which its reads name: the read hooks re-render
 * after a move to another draft, and a locale switch mounts the page afresh.
 */
function useShownTarget(): InDraft {
  return { in: useCurrentDraftId(), locale: React.useContext(ViewLocaleContext)?.locale };
}

const NO_READ: ReadQueryOptions<null> = {
  queryKey: ["camox", "noRead"],
  queryFn: async () => null,
  staleTime: Infinity,
};

/**
 * A read's value during render, suspending until it loads. The caller re-renders after a move to
 * another draft, and reads that draft's key. Without a read, it's null.
 */
export function useRead<T>(read: Read<T, any>): T;
export function useRead<T>(read: Read<T, any> | null): T | null;
export function useRead<T>(read: Read<T, any> | null): T | null {
  const inDraft = useShownTarget();
  const cache = useStudioCache();
  const { data } = useSuspenseQuery<T | null, Error, T | null, QueryKey>(
    read ? cache.options(read, inDraft) : NO_READ,
  );
  return data;
}

/**
 * A read's query, without suspending: pending until it loads, or while not `enabled`. It reads in
 * the locale the caller's render shows, unless `locale` names another.
 */
export function useReadQuery<T, S = T>(
  read: Read<T, any>,
  {
    enabled,
    select,
    locale,
  }: { enabled?: boolean; select?: (value: T) => S; locale?: LocaleView } = {},
): UseQueryResult<S> {
  const shown = useShownTarget();
  const cache = useStudioCache();
  const inDraft = locale ? { ...shown, locale } : shown;
  return useQuery({ ...cache.options(read, inDraft), enabled, select });
}

/** Several reads' queries at once, without suspending. */
export function useReadQueries<T>(list: Read<T, any>[]): UseQueryResult<T>[];
/** Several reads' queries at once, combined into one value that stays the same while they do. */
export function useReadQueries<T, C>(
  list: Read<T, any>[],
  combine: (results: UseQueryResult<T>[]) => C,
): C;
export function useReadQueries<T, C>(
  list: Read<T, any>[],
  combine?: (results: UseQueryResult<T>[]) => C,
) {
  const inDraft = useShownTarget();
  const cache = useStudioCache();
  return useQueries({ queries: list.map((read) => cache.options(read, inDraft)), combine });
}
