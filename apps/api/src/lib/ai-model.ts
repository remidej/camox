import { Context, type Effect } from "effect";

import type { AiCallError } from "./retry-ai-call";

export type SummaryRequest = {
  /** The block or repeatable item's definition type. */
  type: string;
  markdown: string;
  /** Kept unless the content changed meaningfully, so summaries don't churn. */
  previousSummary?: string;
};

export type PageSeoRequest = {
  /** The BCP 47 tag of the page's locale: its SEO is written in that language. */
  locale: string;
  fullPath: string;
  blocks: { type: string; markdown: string }[];
  previousMetaTitle?: string | null;
  previousMetaDescription?: string | null;
};

export type PageSeo = { metaTitle: string; metaDescription: string };

export type ImageMetadataRequest = {
  /** The BCP 47 tag of the locale the alt text is written in. */
  locale: string;
  /** Where the file is served from: the model is shown the image found there. */
  url: string;
  mimeType: string;
  /** The filename shown so far, kept when it's already descriptive. */
  filename: string;
};

export type ImageMetadata = { alt: string; filename: string };

/**
 * One text to translate, named by a key the answer keeps. `plain` is text as people read it,
 * `html` an artifact's source whose markup stays as it is, and `slug` a URL path segment.
 */
export type TranslationText = { key: string; text: string; format: "plain" | "html" | "slug" };

/**
 * What the model knows of the website texts are translated for, from the default locale: its
 * name, and the title and description of the page they're on. Each is absent when unknown.
 */
export type TranslationContext = {
  website?: string;
  pageTitle?: string;
  pageDescription?: string;
};

export type TranslationRequest = {
  /** The default locale's tag, which every locale is translated from (ADR 0015). */
  from: string;
  /** The tag of the locale to translate into. */
  to: string;
  context: TranslationContext;
  texts: readonly TranslationText[];
};

/** The translations of a request's texts, by key. A missing key keeps its text. */
export type Translations = Record<string, string>;

/**
 * One text of a localization someone changed by hand while its source changed too, named by a
 * key the answer keeps: the source and Camox's translation of it when they were last in sync,
 * then the source and the localization now. Besides the formats of translations, `markdown` is
 * rich text merged whole, as Markdown.
 */
export type MergeText = {
  key: string;
  format: TranslationText["format"] | "markdown";
  previousSource: string;
  previousTranslation: string;
  source: string;
  current: string;
};

export type MergeRequest = {
  /** The default locale's tag, the source's locale. */
  from: string;
  /** The tag of the localization's locale. */
  to: string;
  context: TranslationContext;
  texts: readonly MergeText[];
};

/** The merged texts of a request, by key. A missing key keeps the localization's text. */
export type Merges = Record<string, string>;

/** One change a draft makes in the default locale, field by field. */
export type OverviewChange = {
  /** Where it sits: a page's name and path, a layout, a collection, the files or the languages. */
  place: string;
  /** What it is to people: a block's summary or title, a record's title, a file's filename. */
  label: string;
  /** `moved`: only its position changed. */
  change: "created" | "changed" | "deleted" | "moved";
  /** For a changed entity, the fields that differ: Live's value, then the draft's. */
  fields?: { field: string; before: string; after: string }[];
  /** For a created entity, its main values: its first few fields holding one. */
  values?: { field: string; value: string }[];
  /** For a page whose path changed, how many pages under it moved along with it. */
  pagesUnder?: number;
};

/** A draft's changes in one place, counted by kind, once its changes are too many to list. */
export type OverviewPlace = {
  place: string;
  created: number;
  changed: number;
  deleted: number;
  moved: number;
};

/** The edits a draft makes by hand in a locale other than the default one. */
export type OverviewLocaleEdits = {
  /** The locale's BCP 47 tag. */
  locale: string;
  edits: number;
  places: string[];
};

export type DraftOverviewRequest = {
  /** The draft's name, or null while it has none. */
  draftName: string | null;
  /** Hand edits in other locales; what Camox translated is left out. */
  localeEdits: readonly OverviewLocaleEdits[];
} & (
  | { changes: readonly OverviewChange[] }
  /** Past the size cap, the changes are grouped by place instead. */
  | { places: readonly OverviewPlace[] }
);

/** A Draft Overview: a one-sentence headline and bullets covering every change. */
export type DraftOverview = { headline: string; bullets: string[] };

/** One text people wrote, to proofread, named by a key its fixes keep. */
export type ProofreadText = { key: string; text: string };

export type ProofreadRequest = {
  /** The BCP 47 tag of the locale the texts are written in. */
  locale: string;
  texts: readonly ProofreadText[];
};

/**
 * A small fix to one text: the words it gets wrong, `original`, as they appear in it, and what
 * replaces them. Only spelling and clear grammar mistakes, never style.
 */
export type ProofreadFix = {
  key: string;
  kind: "misspelling" | "grammar";
  original: string;
  replacement: string;
};

/**
 * The model that writes generated values (ADR 0012), translations (ADR 0015) and Draft
 * Overviews, and proofreads (ADR 0034). Each call is
 * bounded: it times out, retries transient failures, and fails with `AiCallError` once it gives
 * up. Requests and jobs get the OpenRouter adapter (`open-router-model.ts`); tests get a scripted
 * one.
 */
export class AiModel extends Context.Service<
  AiModel,
  {
    readonly summarize: (request: SummaryRequest) => Effect.Effect<string, AiCallError>;
    readonly pageSeo: (request: PageSeoRequest) => Effect.Effect<PageSeo, AiCallError>;
    readonly imageMetadata: (
      request: ImageMetadataRequest,
    ) => Effect.Effect<ImageMetadata, AiCallError>;
    /** Translates content from the default locale into another locale. */
    readonly translate: (request: TranslationRequest) => Effect.Effect<Translations, AiCallError>;
    /** Merges texts of a localization changed by hand with their changed source, keeping both. */
    readonly merge: (request: MergeRequest) => Effect.Effect<Merges, AiCallError>;
    /** Describes a draft's changes to the members reviewing it. */
    readonly draftOverview: (
      request: DraftOverviewRequest,
    ) => Effect.Effect<DraftOverview, AiCallError>;
    /** Finds spelling and clear grammar mistakes in texts people wrote, each with its fix. */
    readonly proofread: (request: ProofreadRequest) => Effect.Effect<ProofreadFix[], AiCallError>;
  }
>()("camox/AiModel") {}
