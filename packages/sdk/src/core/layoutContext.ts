import { localizedPath, type LocaleView } from "../lib/locale-path";

/**
 * The context every layout `to*` option receives. Each name always means the same thing and is
 * absent where it doesn't apply: curated pages have no loader, so no `data` or `params`, and only
 * record pages have `content`.
 */

/** The page a layout renders. */
export interface LayoutPage {
  /**
   * The undecorated title: the editor's or generated meta title on curated pages, the layout's
   * title on singleton and derived pages, the record's Label on record pages.
   */
  title: string;
  /** The editor's or generated description on curated pages. Absent otherwise. */
  description: string | undefined;
  /** The page's path, with its locale's prefix. */
  path: string;
  /** The tag of the locale the page renders in, such as `de`. */
  locale: string;
}

/** The project a page belongs to. */
export interface LayoutProject {
  name: string;
}

/** What every layout `to*` option knows about a curated page. */
export interface CuratedLayoutContext {
  page: LayoutPage;
  project: LayoutProject;
}

/** What every layout `to*` option knows about a singleton or derived page. */
export interface LoadedLayoutContext<
  Data = unknown,
  Params = Record<string, string>,
> extends CuratedLayoutContext {
  data: Data;
  params: Params;
}

/** On record pages, `content` holds the record's values: its String fields as plain text. */
export interface RecordLayoutContext<
  Data = unknown,
  Params = Record<string, string>,
  Content = Record<string, string>,
> extends LoadedLayoutContext<Data, Params> {
  content: Content;
}

/** Any layout's context, as the runtime builds it. */
export type AnyLayoutContext = CuratedLayoutContext &
  Partial<Pick<RecordLayoutContext, "data" | "params" | "content">>;

/** The record a record page renders, as its context names it. */
export interface RecordPageValues {
  /** The record's Label, as plain text. */
  title: string;
  /** The record's String fields as plain text. */
  content: Record<string, string>;
}

/** What a page's context is built from. */
export interface LayoutContextSource {
  /** The editor's or generated meta title. Only curated pages have one. */
  metaTitle?: string;
  /** The editor's or generated description. Only curated pages have one. */
  description?: string;
  /** The page's path, with its locale's prefix. */
  path: string;
  locale: string;
  projectName: string;
  data?: unknown;
  params?: Record<string, string>;
  /** The record a record page renders. */
  record?: RecordPageValues;
}

/** A curated page's undecorated title: its meta title, or its path segment while it has none. */
export function curatedPageTitle(page: { pathSegment: string; metaTitle?: string | null }) {
  return page.metaTitle ?? page.pathSegment;
}

/** A curated page's context, from its editor metadata. Its path keeps its locale's prefix. */
export function curatedLayoutContext(
  structure: {
    page: {
      fullPath: string;
      pathSegment: string;
      metaTitle?: string | null;
      metaDescription?: string | null;
    };
    projectName: string;
  },
  locale: LocaleView,
): AnyLayoutContext {
  const { page } = structure;
  return buildLayoutContext(
    { kind: "curated", title: "" },
    {
      metaTitle: curatedPageTitle(page),
      description: page.metaDescription ?? undefined,
      path: localizedPath(page.fullPath, locale),
      locale: locale.tag,
      projectName: structure.projectName,
    },
  );
}

/** The context a layout's `to*` options receive on a page. */
export function buildLayoutContext(
  layout: { kind: "curated" | "derived" | "singleton"; title: string },
  source: LayoutContextSource,
): AnyLayoutContext {
  const project = { name: source.projectName };
  const page = { path: source.path, locale: source.locale };
  if (layout.kind === "curated")
    return {
      page: { title: source.metaTitle ?? "", description: source.description, ...page },
      project,
    };
  return {
    page: { title: source.record?.title ?? layout.title, description: undefined, ...page },
    project,
    data: source.data,
    params: source.params ?? {},
    ...(source.record && { content: source.record.content }),
  };
}
