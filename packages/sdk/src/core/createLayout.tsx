import type { TSchema } from "@sinclair/typebox";
import * as React from "react";

import { BlockErrorBoundary } from "@/features/preview/components/BlockErrorBoundary";
import { useOptionalCamoxApp } from "@/features/provider/components/CamoxAppContext";

import { useBlockEditingRuntime } from "./editing/BlockEditingRuntime";
import type { ContentProxy } from "./lib/contentType";
import { RecordScope } from "./lib/recordScope";
import type { ReferenceScope } from "./lib/reference";
import { asCollectionItem, fieldPlainText } from "./recordItem";
import type { CollectionRecordId, LayoutRequestContext, LoadedRecord } from "./requestContext";

export type { LayoutRequestContext } from "./requestContext";

/* -------------------------------------------------------------------------------------------------
 * createLayout
 * -----------------------------------------------------------------------------------------------*/

export interface OgImageParams {
  title: string;
  description: string;
  projectName: string;
}

export interface LayoutBlockData {
  _id: string;
  type: string;
  content: Record<string, unknown>;
  settings?: Record<string, unknown>;
  position: string;
}

/** Minimal block interface — avoids importing the full generic Block type. */
interface LayoutBlock<TLayoutOnly extends boolean = boolean> {
  _internal: {
    id: string;
    layoutOnly: TLayoutOnly;
    Component: React.ComponentType<{
      blockData: any;
      mode: "site" | "peek" | "layout";
      isFirstBlock?: boolean;
      showAddBlockTop?: boolean;
      showAddBlockBottom?: boolean;
      addBlockAfterPosition?: string | null;
    }>;
    getInitialBundle: () => {
      content: Record<string, unknown>;
      settings: Record<string, unknown>;
      repeatableItems: Array<{
        tempId: string;
        parentTempId: string | null;
        fieldName: string;
        content: Record<string, unknown>;
        position: string;
      }>;
    };
  };
}

/**
 * Per-element validators that produce a human-readable error string when a block
 * is in the wrong slot. We use mapped types (instead of `LayoutBlock<true>[]` /
 * `LayoutBlock<false>[]`) so TypeScript reports
 *   `Type 'X' is not assignable to type '❌ Camox: ...'`
 * instead of the unreadable structural diff on the full Block shape.
 */
type ValidateLayoutOnlyBlocks<T extends readonly LayoutBlock[]> = {
  [K in keyof T]: T[K] extends LayoutBlock<true>
    ? T[K]
    : "❌ Camox: blocks in `blocks.before` and `blocks.after` must be defined with `layoutOnly: true`. Add `layoutOnly: true` to this block's `createBlock` options.";
};

/**
 * A block module, imported only when Camox seeds the initial page. A static import would put
 * the block in every visitor's bundle, since layouts load on every page.
 */
type InitialBlockImport = () => Promise<{ block: LayoutBlock }>;

const INITIAL_LAYOUT_ONLY_ERROR =
  "❌ Camox: blocks in `blocks.initial` must NOT be `layoutOnly: true` — `initial` is for page-content blocks. Remove `layoutOnly: true` from this block's `createBlock` options.";

type ValidatePageContentBlocks<T extends readonly InitialBlockImport[]> = {
  [K in keyof T]: Awaited<ReturnType<T[K]>>["block"] extends LayoutBlock<true>
    ? typeof INITIAL_LAYOUT_ONLY_ERROR
    : T[K];
};

/** Successful ordinary loader result. Data must be JSON-serializable. */
export interface LayoutLoaderResult<Data = unknown> {
  kind: "data";
  data: Data;
}

declare const collectionFields: unique symbol;

/**
 * A loader result rendering one collection record, as `collection.pages()` returns it. Wrappers
 * keep the page bound to its record by returning it unchanged.
 */
export interface LayoutCollectionItemResult<
  Content = Record<string, unknown>,
  CollectionId extends string = string,
  Fields extends Record<string, TSchema> = any,
> {
  kind: "collection-item";
  collectionId: CollectionId;
  data: LoadedRecord<Content>;
  /**
   * Type only, never set: the collection's fields, which type `layout.Item`. Invariant, so that
   * records of two collections never merge into one.
   */
  readonly [collectionFields]?: (fields: Fields) => Fields;
}

/** What `loader` receives: the page's params and the request context to pass through. */
export interface LayoutLoaderContext<Params = Record<string, string>> {
  params: Params;
  context: LayoutRequestContext;
}

/** What `routes` receives: the request context to pass through. */
export interface LayoutRoutesContext {
  context: LayoutRequestContext;
}

/** Every successful loader result, before `useData` unwraps it. */
export type AnyLayoutLoaderResult = LayoutLoaderResult | LayoutCollectionItemResult;
type LoaderReturn = AnyLayoutLoaderResult | PromiseLike<AnyLayoutLoaderResult>;

/** The record a discovered page renders, independent of its current params. */
export interface LayoutRouteTarget extends CollectionRecordId {
  kind: "collection-item";
  /** The record's Label, which names its page where pages are listed (llms.txt). */
  label?: string;
}

/** Route discovery result: the params of each page a derived layout can render. */
export interface LayoutRoutesResult<Params = Record<string, string>> {
  data: ReadonlyArray<{ params: Params; target?: LayoutRouteTarget }>;
}

type RoutesReturn<Params> = LayoutRoutesResult<Params> | PromiseLike<LayoutRoutesResult<Params>>;
type LoaderData<Result extends LoaderReturn> = [Result] extends [never]
  ? undefined
  : Awaited<Result>["data"];

type ResultFields<R> = R extends LayoutCollectionItemResult<any, any, infer F> ? F : never;
type IsUnion<T, U = T> = T extends unknown ? ([U] extends [T] ? false : true) : never;
type IsAny<T> = 0 extends 1 & T ? true : false;

/**
 * The fields of the one collection whose records every loader result renders. `never` for
 * external data, mixed results, several collections, or an envelope typed without its fields.
 */
type RecordFields<Result> = [Awaited<Result>] extends [never]
  ? never
  : [Awaited<Result>] extends [LayoutCollectionItemResult<any, any, any>]
    ? true extends IsUnion<ResultFields<Awaited<Result>>>
      ? never
      : IsAny<ResultFields<Awaited<Result>>> extends true
        ? never
        : ResultFields<Awaited<Result>>
    : never;

type StringFieldKeys<F> = {
  [K in keyof F & string]: F[K] extends { fieldType: "String" } ? K : never;
}[keyof F & string];

/** Record pages' meta callbacks also get the record's String fields as plain text. */
type MetaItem<F> = [F] extends [never] ? {} : { item: { [K in StringFieldKeys<F>]: string } };

/** Record pages' `toMarkdown` also gets `item`, the reference-list Markdown builder. */
type MarkdownItem<F> = [F] extends [never]
  ? {}
  : F extends Record<string, TSchema>
    ? { item: ContentProxy<F> }
    : {};

/** `layout.Item` exists only on layouts whose loader renders records of one collection. */
type ItemScope<F> = [F] extends [never]
  ? {}
  : F extends Record<string, TSchema>
    ? {
        /** The page's record, read-only, with typed fields and the records it links. */
        Item: (props: {
          children: (item: ReferenceScope<F>) => React.ReactNode;
        }) => React.ReactNode;
      }
    : {};

/** What a page's metadata callbacks know about it. Curated pages have no loader data or params. */
export interface PageMetaContext<Data = unknown, Params = Record<string, string>> {
  projectName: string;
  pageFullPath: string;
  data: Data;
  params: Params;
}

/** On singleton and derived pages, `pageMetaTitle` is the layout's `title`. */
type BuildMetaTitle<Data, Params, F = never> = (
  params: PageMetaContext<Data, Params> & { pageMetaTitle: string } & MetaItem<F>,
) => string;

/** Without it, curated pages use the editor's description and other pages have none. */
type BuildMetaDescription<Data, Params, F = never> = (
  params: PageMetaContext<Data, Params> & {
    pageMetaDescription: string | undefined;
  } & MetaItem<F>,
) => string | undefined;

/** The Markdown Representation of a code-owned page, between its layout blocks. */
type LayoutToMarkdown<Data, Params, F = never> = (
  context: { data: Data; params: Params } & MarkdownItem<F>,
) => readonly string[];

/** The collection a layout's record pages render, and the field each record is found by. */
export type RecordPages = { collectionId: string; field: string };

interface CreateLayoutOptions<
  TBefore extends readonly LayoutBlock[],
  TAfter extends readonly LayoutBlock[],
  TInitial extends readonly InitialBlockImport[],
  Result extends LoaderReturn = LoaderReturn,
> {
  id: string;
  kind?: "curated" | "derived" | "singleton";
  loader?: (context: LayoutLoaderContext) => Result;
  /** Lists the pages of a derived layout, for the sitemap and the Canvas. */
  routes?: (context: LayoutRoutesContext) => RoutesReturn<Record<string, string>>;
  /** A derived layout's record pages, set by spreading `collection.pages(...)`. */
  recordPages?: RecordPages;
  title: string;
  description: string;
  blocks: {
    before: ValidateLayoutOnlyBlocks<TBefore>;
    after: ValidateLayoutOnlyBlocks<TAfter>;
    /**
     * Ordered list of blocks to create on the initial page when a project is first set up, as
     * imports of their modules: `[() => import("../blocks/hero")]`.
     */
    initial?: ValidatePageContentBlocks<TInitial>;
  };
  component: React.ComponentType<{ children: React.ReactNode }>;
  buildMetaTitle: BuildMetaTitle<LoaderData<Result>, Record<string, string>, RecordFields<Result>>;
  buildMetaDescription?: BuildMetaDescription<
    LoaderData<Result>,
    Record<string, string>,
    RecordFields<Result>
  >;
  /** Singleton and derived layouts only. */
  toMarkdown?: LayoutToMarkdown<LoaderData<Result>, Record<string, string>, RecordFields<Result>>;
  buildOgImage?: (params: OgImageParams) => React.ReactElement;
}

function createLayoutDefinition<
  const TBefore extends readonly LayoutBlock[],
  const TAfter extends readonly LayoutBlock[],
  const TInitial extends readonly InitialBlockImport[] = [],
>(options: CreateLayoutOptions<TBefore, TAfter, TInitial>) {
  if (options.kind === "singleton" && !/^[\w-]+(?:\.[\w-]+)*$/.test(options.id))
    throw new Error(`Singleton layouts require a fixed file route: ${options.id}`);
  if (options.kind && options.kind !== "curated" && options.blocks.initial)
    throw new Error("Code-owned layouts cannot define initial page blocks");
  if (options.routes && options.kind !== "derived")
    throw new Error(`Only derived layouts can define routes: ${options.id}`);
  if (options.toMarkdown && (options.kind ?? "curated") === "curated")
    throw new Error(`Curated layouts cannot define toMarkdown: ${options.id}`);

  // Each layout gets its own context — avoids cross-module identity issues
  const LayoutContext = React.createContext<{
    layoutBlocks: Record<string, LayoutBlockData>;
    result?: AnyLayoutLoaderResult;
  } | null>(null);

  // Cast away the validation mapped type — once user-side type-checking has passed,
  // the runtime values are valid LayoutBlock arrays.
  const beforeBlocks = options.blocks.before as unknown as LayoutBlock<true>[];
  const afterBlocks = options.blocks.after as unknown as LayoutBlock<true>[];
  const initialBlocks = options.blocks.initial as unknown as InitialBlockImport[] | undefined;

  const BeforeBlocks = () => {
    const ctx = React.use(LayoutContext);
    if (!ctx) {
      throw new Error(`Layout "${options.id}" BeforeBlocks must be rendered inside its Provider`);
    }
    return (
      <>
        {beforeBlocks.map((block, i) => {
          const blockData = ctx.layoutBlocks[block._internal.id];
          if (!blockData) return null;
          const isLastBefore = i === beforeBlocks.length - 1;
          return (
            <BlockErrorBoundary
              key={block._internal.id}
              blockId={blockData._id}
              blockType={blockData.type}
            >
              <block._internal.Component
                blockData={blockData}
                mode="layout"
                showAddBlockBottom={
                  ((options.kind ?? "curated") === "curated" && isLastBefore) || undefined
                }
                addBlockAfterPosition={isLastBefore ? "" : undefined}
              />
            </BlockErrorBoundary>
          );
        })}
      </>
    );
  };
  BeforeBlocks.displayName = `LayoutBeforeBlocks(${options.id})`;

  const AfterBlocks = () => {
    const ctx = React.use(LayoutContext);
    if (!ctx) {
      throw new Error(`Layout "${options.id}" AfterBlocks must be rendered inside its Provider`);
    }
    return (
      <>
        {afterBlocks.map((block, i) => {
          const blockData = ctx.layoutBlocks[block._internal.id];
          if (!blockData) return null;
          const isFirstAfter = i === 0;
          return (
            <BlockErrorBoundary
              key={block._internal.id}
              blockId={blockData._id}
              blockType={blockData.type}
            >
              <block._internal.Component
                blockData={blockData}
                mode="layout"
                showAddBlockTop={
                  ((options.kind ?? "curated") === "curated" && isFirstAfter) || undefined
                }
                addBlockAfterPosition={isFirstAfter ? null : undefined}
              />
            </BlockErrorBoundary>
          );
        })}
      </>
    );
  };
  AfterBlocks.displayName = `LayoutAfterBlocks(${options.id})`;

  // Provider component that wraps the layout — shares context with slots
  const Provider = ({
    layoutBlocks,
    children,
    result,
  }: {
    layoutBlocks: Record<string, LayoutBlockData>;
    children: React.ReactNode;
    result?: AnyLayoutLoaderResult;
  }) => {
    const value = React.useMemo(() => ({ layoutBlocks, result }), [layoutBlocks, result]);
    return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>;
  };

  /**
   * Renders the page's record; nothing when the loader result isn't a record. Visitors get it
   * read-only; the Studio's editing runtime makes it editable.
   */
  const Item = ({ children }: { children: (item: any) => React.ReactNode }) => {
    const context = React.use(LayoutContext);
    const app = useOptionalCamoxApp();
    const editingRuntime = useBlockEditingRuntime();
    if (!context)
      throw new Error(`Layout "${options.id}" Item must be rendered inside its Provider`);
    const result = asCollectionItem(context.result);
    if (!result) return null;
    const collection = app?.getCollectionById(result.collectionId);
    if (!collection) return null;
    const { contentSchema, label } = collection._internal;
    const { id, content, references } = result.data;
    const readOnly = (
      <RecordScope
        record={{ id, label: fieldPlainText(content[label]), content, references }}
        properties={contentSchema.properties}
        hop={1}
      >
        {children}
      </RecordScope>
    );
    if (!editingRuntime?.renderLayoutItem) return readOnly;
    return editingRuntime.renderLayoutItem({
      collectionId: result.collectionId,
      labelField: label,
      properties: contentSchema.properties,
      record: result.data,
      children,
      fallback: readOnly,
    });
  };
  Item.displayName = `LayoutItem(${options.id})`;

  // Build block definitions array for sync
  const blockDefinitions = [
    ...beforeBlocks.map((block) => {
      const bundle = block._internal.getInitialBundle();
      return {
        type: block._internal.id,
        content: bundle.content,
        settings: bundle.settings,
        repeatableItems: bundle.repeatableItems,
        slot: "before" as const,
      };
    }),
    ...afterBlocks.map((block) => {
      const bundle = block._internal.getInitialBundle();
      return {
        type: block._internal.id,
        content: bundle.content,
        settings: bundle.settings,
        repeatableItems: bundle.repeatableItems,
        slot: "after" as const,
      };
    }),
  ];

  const buildOgImage = options.buildOgImage
    ? async (params: OgImageParams): Promise<Response> => {
        // OG rendering is server-only. This guard also lets Vite remove the
        // WASM import from client builds.
        if (import.meta.env?.SSR === false) {
          throw new Error("OG images can only be rendered on the server.");
        }
        const { ImageResponse } = await import("camox/_internal/imageResponse");
        const jsx = options.buildOgImage!(params);
        return new ImageResponse(jsx, { width: 1200, height: 630 });
      }
    : undefined;

  const loadInitialBlockBundles =
    initialBlocks &&
    (() =>
      Promise.all(
        initialBlocks.map(async (load) => {
          const { block } = await load();
          // Type checking reports this too, but plain JavaScript layouts skip it.
          if (block._internal.layoutOnly)
            throw new Error(`${INITIAL_LAYOUT_ONLY_ERROR} (block "${block._internal.id}")`);
          const bundle = block._internal.getInitialBundle();
          return {
            type: block._internal.id,
            content: bundle.content,
            settings: bundle.settings,
            repeatableItems: bundle.repeatableItems,
          };
        }),
      ));

  return {
    BeforeBlocks,
    AfterBlocks,
    Item,
    useData() {
      const context = React.use(LayoutContext);
      if (!context)
        throw new Error(`Layout "${options.id}" useData must be rendered inside its Provider`);
      return context.result?.data;
    },
    _internal: {
      id: options.id,
      kind: options.kind ?? "curated",
      loader: options.loader,
      routes: options.routes,
      recordPages: options.recordPages,
      title: options.title,
      description: options.description,
      buildMetaTitle: options.buildMetaTitle as BuildMetaTitle<unknown, unknown>,
      buildMetaDescription: options.buildMetaDescription as
        | BuildMetaDescription<unknown, unknown>
        | undefined,
      // Record pages' `toMarkdown` also gets `item`; the runtime passes it only for records.
      toMarkdown: options.toMarkdown as
        | ((context: { data: unknown; params: unknown; item?: unknown }) => readonly string[])
        | undefined,
      buildOgImage,
      blockDefinitions,
      loadInitialBlockBundles,
      component: options.component,
      Provider,
    },
  };
}

/** Any layout. `Item` is typed per layout, and only exists on record layouts' types. */
export type Layout = Omit<ReturnType<typeof createLayoutDefinition>, "Item">;

/** A layout typed by its loader: `useData` returns the loaded data, `Item` renders its record. */
type LayoutFor<Result extends LoaderReturn> = Omit<Layout, "useData" | "Item"> & {
  useData: () => LoaderData<Result>;
} & ItemScope<RecordFields<Result>>;

export interface LayoutFileRoutes {}

type Params<Id extends string> = Id extends `${infer Head}.${infer Tail}`
  ? Params<Head> & Params<Tail>
  : Id extends `$${infer Name}`
    ? { [K in Name]: string }
    : {};

type RouteParams<Id extends string> = Id extends keyof LayoutFileRoutes
  ? LayoutFileRoutes[Id] extends { params: infer P }
    ? P
    : Params<Id>
  : Params<Id>;

type FileOptions<
  Id extends string,
  Result extends LoaderReturn,
  B extends readonly LayoutBlock[],
  A extends readonly LayoutBlock[],
  I extends readonly InitialBlockImport[],
> = Omit<
  CreateLayoutOptions<B, A, I>,
  | "id"
  | "kind"
  | "loader"
  | "routes"
  | "recordPages"
  | "component"
  | "buildMetaTitle"
  | "buildMetaDescription"
  | "toMarkdown"
> &
  (
    | {
        kind: "curated";
        component: React.ComponentType<{ children: React.ReactNode }>;
        loader?: never;
        routes?: never;
        recordPages?: never;
        toMarkdown?: never;
        buildMetaTitle: BuildMetaTitle<undefined, Record<string, never>>;
        buildMetaDescription?: BuildMetaDescription<undefined, Record<string, never>>;
      }
    | {
        kind: "singleton";
        blocks: {
          before: ValidateLayoutOnlyBlocks<B>;
          after: ValidateLayoutOnlyBlocks<A>;
          initial?: never;
        };
        loader?: (context: LayoutLoaderContext<Record<string, never>>) => Result;
        routes?: never;
        recordPages?: never;
        toMarkdown?: LayoutToMarkdown<
          LoaderData<Result>,
          Record<string, never>,
          RecordFields<Result>
        >;
        component: React.ComponentType<{ children?: never }>;
        buildMetaTitle: BuildMetaTitle<
          LoaderData<Result>,
          Record<string, never>,
          RecordFields<Result>
        >;
        buildMetaDescription?: BuildMetaDescription<
          LoaderData<Result>,
          Record<string, never>,
          RecordFields<Result>
        >;
      }
    | {
        kind: "derived";
        blocks: {
          before: ValidateLayoutOnlyBlocks<B>;
          after: ValidateLayoutOnlyBlocks<A>;
          initial?: never;
        };
        loader: (context: LayoutLoaderContext<RouteParams<Id>>) => Result;
        routes?: (context: LayoutRoutesContext) => RoutesReturn<RouteParams<Id>>;
        recordPages?: RecordPages;
        toMarkdown?: LayoutToMarkdown<LoaderData<Result>, RouteParams<Id>, RecordFields<Result>>;
        component: React.ComponentType<{ children?: never }>;
        buildMetaTitle: BuildMetaTitle<LoaderData<Result>, RouteParams<Id>, RecordFields<Result>>;
        buildMetaDescription?: BuildMetaDescription<
          LoaderData<Result>,
          RouteParams<Id>,
          RecordFields<Result>
        >;
      }
  );

export function createLayout<
  const B extends readonly LayoutBlock[],
  const A extends readonly LayoutBlock[],
  const I extends readonly InitialBlockImport[] = [],
  Result extends LoaderReturn = never,
>(options: CreateLayoutOptions<B, A, I, Result>): LayoutFor<Result>;
export function createLayout<const Id extends string>(
  id: Id,
): <
  Result extends LoaderReturn = never,
  const B extends readonly LayoutBlock[] = [],
  const A extends readonly LayoutBlock[] = [],
  const I extends readonly InitialBlockImport[] = [],
>(
  options: FileOptions<Id, Result, B, A, I>,
) => LayoutFor<Result>;
export function createLayout(idOrOptions: string | CreateLayoutOptions<any, any, any>): any {
  if (typeof idOrOptions !== "string") return createLayoutDefinition(idOrOptions);
  return (options: CreateLayoutOptions<any, any, any>) =>
    createLayoutDefinition({ ...options, id: idOrOptions });
}

export { notFound } from "./notFound";
