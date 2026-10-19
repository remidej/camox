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

export type TranslationRequest = {
  /** The default locale's tag, which every locale is translated from (ADR 0015). */
  from: string;
  /** The tag of the locale to translate into. */
  to: string;
  texts: readonly TranslationText[];
};

/** The translations of a request's texts, by key. A missing key keeps its text. */
export type Translations = Record<string, string>;

/**
 * One text of a localization someone changed by hand while its source changed too, named by a
 * key the answer keeps: the source and Camox's translation of it when they were last in sync,
 * then the source and the localization now.
 */
export type MergeText = {
  key: string;
  format: TranslationText["format"];
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
  texts: readonly MergeText[];
};

/** The merged texts of a request, by key. A missing key keeps the localization's text. */
export type Merges = Record<string, string>;

/**
 * The model that writes generated values (ADR 0012) and translations (ADR 0015). Each call is
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
  }
>()("camox/AiModel") {}
