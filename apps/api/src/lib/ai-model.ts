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
  fullPath: string;
  blocks: { type: string; markdown: string }[];
  previousMetaTitle?: string | null;
  previousMetaDescription?: string | null;
};

export type PageSeo = { metaTitle: string; metaDescription: string };

export type ImageMetadataRequest = {
  /** Where the file is served from: the model is shown the image found there. */
  url: string;
  mimeType: string;
  /** The filename shown so far, kept when it's already descriptive. */
  filename: string;
};

export type ImageMetadata = { alt: string; filename: string };

/**
 * The model that writes generated values (ADR 0012). Each call is bounded: it times out, retries
 * transient failures, and fails with `AiCallError` once it gives up. Requests and jobs get the
 * OpenRouter adapter (`open-router-model.ts`); tests get a scripted one.
 */
export class AiModel extends Context.Service<
  AiModel,
  {
    readonly summarize: (request: SummaryRequest) => Effect.Effect<string, AiCallError>;
    readonly pageSeo: (request: PageSeoRequest) => Effect.Effect<PageSeo, AiCallError>;
    readonly imageMetadata: (
      request: ImageMetadataRequest,
    ) => Effect.Effect<ImageMetadata, AiCallError>;
  }
>()("camox/AiModel") {}
