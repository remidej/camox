import * as React from "react";

import { BlockErrorBoundary } from "@/features/preview/components/BlockErrorBoundary";

import type { LayoutRequestContext } from "./requestContext";

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
  _id: number;
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

type ValidatePageContentBlocks<T extends readonly LayoutBlock[]> = {
  [K in keyof T]: T[K] extends LayoutBlock<true>
    ? "❌ Camox: blocks in `blocks.initial` must NOT be `layoutOnly: true` — `initial` is for page-content blocks. Remove `layoutOnly: true` from this block's `createBlock` options."
    : T[K];
};

/** Successful ordinary loader result. Data must be JSON-serializable. */
export interface LayoutLoaderResult<Data = unknown> {
  kind: "data";
  data: Data;
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

type LoaderReturn = LayoutLoaderResult | PromiseLike<LayoutLoaderResult>;

/** Route discovery result: the params of each page a derived layout can render. */
export interface LayoutRoutesResult<Params = Record<string, string>> {
  data: ReadonlyArray<{ params: Params }>;
}

type RoutesReturn<Params> = LayoutRoutesResult<Params> | PromiseLike<LayoutRoutesResult<Params>>;
type LoaderData<Result extends LoaderReturn> = [Result] extends [never]
  ? undefined
  : Awaited<Result>["data"];

/** What a page's metadata callbacks know about it. Curated pages have no loader data or params. */
export interface PageMetaContext<Data = unknown, Params = Record<string, string>> {
  projectName: string;
  pageFullPath: string;
  data: Data;
  params: Params;
}

/** On singleton and derived pages, `pageMetaTitle` is the layout's `title`. */
type BuildMetaTitle<Data, Params> = (
  params: PageMetaContext<Data, Params> & { pageMetaTitle: string },
) => string;

/** Without it, curated pages use the editor's description and other pages have none. */
type BuildMetaDescription<Data, Params> = (
  params: PageMetaContext<Data, Params> & { pageMetaDescription: string | undefined },
) => string | undefined;

/** The Markdown Representation of a code-owned page, between its layout blocks. */
type LayoutToMarkdown<Data, Params> = (context: {
  data: Data;
  params: Params;
}) => readonly string[];

interface CreateLayoutOptions<
  TBefore extends readonly LayoutBlock[],
  TAfter extends readonly LayoutBlock[],
  TInitial extends readonly LayoutBlock[],
  Result extends LoaderReturn = LoaderReturn,
> {
  id: string;
  kind?: "curated" | "derived" | "singleton";
  loader?: (context: LayoutLoaderContext) => Result;
  /** Lists the pages of a derived layout, for the sitemap and the Canvas. */
  routes?: (context: LayoutRoutesContext) => RoutesReturn<Record<string, string>>;
  title: string;
  description: string;
  blocks: {
    before: ValidateLayoutOnlyBlocks<TBefore>;
    after: ValidateLayoutOnlyBlocks<TAfter>;
    /** Ordered list of blocks to create on the initial page when a project is first set up. */
    initial?: ValidatePageContentBlocks<TInitial>;
  };
  component: React.ComponentType<{ children: React.ReactNode }>;
  buildMetaTitle: BuildMetaTitle<LoaderData<Result>, Record<string, string>>;
  buildMetaDescription?: BuildMetaDescription<LoaderData<Result>, Record<string, string>>;
  /** Singleton and derived layouts only. */
  toMarkdown?: LayoutToMarkdown<LoaderData<Result>, Record<string, string>>;
  buildOgImage?: (params: OgImageParams) => React.ReactElement;
}

function createLayoutDefinition<
  const TBefore extends readonly LayoutBlock[],
  const TAfter extends readonly LayoutBlock[],
  const TInitial extends readonly LayoutBlock[] = [],
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
    result?: LayoutLoaderResult;
  } | null>(null);

  // Cast away the validation mapped type — once user-side type-checking has passed,
  // the runtime values are valid LayoutBlock arrays.
  const beforeBlocks = options.blocks.before as unknown as LayoutBlock<true>[];
  const afterBlocks = options.blocks.after as unknown as LayoutBlock<true>[];
  const initialBlocks = options.blocks.initial as unknown as LayoutBlock<false>[] | undefined;

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
    result?: LayoutLoaderResult;
  }) => {
    const value = React.useMemo(() => ({ layoutBlocks, result }), [layoutBlocks, result]);
    return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>;
  };

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
        // WASM import from client builds, where Nitro's WASM loader is absent.
        if (import.meta.env?.SSR === false) {
          throw new Error("OG images can only be rendered on the server.");
        }
        // Conditional exports select the appropriate WASM loader for the runtime.
        const { ImageResponse } = await import("camox/_internal/imageResponse");
        const jsx = options.buildOgImage!(params);
        return new ImageResponse(jsx, { width: 1200, height: 630 });
      }
    : undefined;

  const initialBlockBundles = initialBlocks?.map((block) => {
    const bundle = block._internal.getInitialBundle();
    return {
      type: block._internal.id,
      content: bundle.content,
      settings: bundle.settings,
      repeatableItems: bundle.repeatableItems,
    };
  });

  return {
    BeforeBlocks,
    AfterBlocks,
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
      title: options.title,
      description: options.description,
      buildMetaTitle: options.buildMetaTitle as BuildMetaTitle<unknown, unknown>,
      buildMetaDescription: options.buildMetaDescription as
        | BuildMetaDescription<unknown, unknown>
        | undefined,
      toMarkdown: options.toMarkdown as LayoutToMarkdown<unknown, unknown> | undefined,
      buildOgImage,
      blockDefinitions,
      initialBlockBundles,
      component: options.component,
      Provider,
    },
  };
}

export type Layout = ReturnType<typeof createLayoutDefinition>;

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
  I extends readonly LayoutBlock[],
> = Omit<
  CreateLayoutOptions<B, A, I>,
  | "id"
  | "kind"
  | "loader"
  | "routes"
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
        toMarkdown?: LayoutToMarkdown<LoaderData<Result>, Record<string, never>>;
        component: React.ComponentType<{ children?: never }>;
        buildMetaTitle: BuildMetaTitle<LoaderData<Result>, Record<string, never>>;
        buildMetaDescription?: BuildMetaDescription<LoaderData<Result>, Record<string, never>>;
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
        toMarkdown?: LayoutToMarkdown<LoaderData<Result>, RouteParams<Id>>;
        component: React.ComponentType<{ children?: never }>;
        buildMetaTitle: BuildMetaTitle<LoaderData<Result>, RouteParams<Id>>;
        buildMetaDescription?: BuildMetaDescription<LoaderData<Result>, RouteParams<Id>>;
      }
  );

export function createLayout<
  const B extends readonly LayoutBlock[],
  const A extends readonly LayoutBlock[],
  const I extends readonly LayoutBlock[] = [],
  Result extends LoaderReturn = never,
>(
  options: CreateLayoutOptions<B, A, I, Result>,
): Omit<Layout, "useData"> & {
  useData: () => LoaderData<Result>;
};
export function createLayout<const Id extends string>(
  id: Id,
): <
  Result extends LoaderReturn = never,
  const B extends readonly LayoutBlock[] = [],
  const A extends readonly LayoutBlock[] = [],
  const I extends readonly LayoutBlock[] = [],
>(
  options: FileOptions<Id, Result, B, A, I>,
) => Omit<Layout, "useData"> & { useData: () => LoaderData<Result> };
export function createLayout(idOrOptions: string | CreateLayoutOptions<any, any, any>): any {
  if (typeof idOrOptions !== "string") return createLayoutDefinition(idOrOptions);
  return (options: CreateLayoutOptions<any, any, any>) =>
    createLayoutDefinition({ ...options, id: idOrOptions });
}

/** Signal a missing derived page; other loader failures remain server errors. */
export function notFound() {
  return Object.assign(new Error("Page not found"), { status: 404, code: "NOT_FOUND" });
}
