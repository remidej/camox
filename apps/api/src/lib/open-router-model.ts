import { chat } from "@tanstack/ai";
import { createOpenRouterText } from "@tanstack/ai-openrouter";
import { Effect } from "effect";
import { outdent } from "outdent";
import { z } from "zod";

import { readMetadataImage } from "../domains/files/metadata-image";
import { AiModel } from "./ai-model";
import { transformImageUrl } from "./image-transform";
import { retryAiCall } from "./retry-ai-call";

/**
 * Writes every generated value. Chosen in October 2026 after running these prompts
 * across 17 models: it followed every format rule on all three jobs.
 */
const MODEL = "google/gemini-3.1-flash-lite";

/** The model that writes generated values, through OpenRouter. */
export const openRouterModel = (apiKey: string) =>
  AiModel.of({
    summarize: (request) =>
      retryAiCall("summary", (abortController) =>
        Effect.promise(() =>
          chat({
            adapter: createOpenRouterText(MODEL, apiKey),
            stream: false,
            abortController,
            messages: [{ role: "user", content: summaryPrompt(request) }],
          }),
        ),
      ),

    pageSeo: (request) =>
      retryAiCall("seo", (abortController) =>
        Effect.promise(() =>
          chat({
            adapter: createOpenRouterText(MODEL, apiKey),
            abortController,
            outputSchema: z.object({ metaTitle: z.string(), metaDescription: z.string() }),
            messages: [{ role: "user", content: pageSeoPrompt(request) }],
          }),
        ),
      ),

    imageMetadata: (request) =>
      retryAiCall("fileMetadata", (abortController) =>
        Effect.gen(function* () {
          // Larger images only add input tokens: alt text and a filename don't need the
          // detail. Bound BOTH dimensions so very tall or very wide images shrink too.
          // Force WebP so the payload is small and the format is accepted across vision
          // models (AVIF support is inconsistent). SVG passes through unchanged.
          const optimizedUrl = transformImageUrl(request.url, {
            width: 768,
            height: 768,
            format: "webp",
            mimeType: request.mimeType,
          });
          // Fetch image server-side — the AI provider can't reach localhost URLs in development
          const response = yield* Effect.promise(() =>
            fetch(optimizedUrl, { signal: abortController.signal }),
          );
          // An unusable image fails the attempt like any other error, so it's retried.
          const { bytes, mimeType } = yield* readMetadataImage(response);
          let binary = "";
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
          const base64 = btoa(binary);

          return yield* Effect.promise(() =>
            chat({
              adapter: createOpenRouterText(MODEL, apiKey),
              abortController,
              outputSchema: z.object({ filename: z.string(), alt: z.string() }),
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      type: "image" as const,
                      source: { type: "data" as const, value: base64, mimeType },
                    },
                    { type: "text" as const, content: imageMetadataPrompt(request.filename) },
                  ],
                },
              ],
            }),
          );
        }),
      ),
  });

function summaryPrompt(request: { type: string; markdown: string; previousSummary?: string }) {
  const stabilityBlock = request.previousSummary
    ? outdent`

      <previous_summary>${request.previousSummary}</previous_summary>
      <stability_instruction>
        A summary was previously generated for this content.
        Return the SAME summary unless it is no longer accurate.
        Only change it if the content has meaningfully changed.
      </stability_instruction>
    `
    : "";

  return outdent`
    <instruction>
      Generate a concise summary for a piece of website content.
    </instruction>

    <constraints>
      - MAXIMUM 4 WORDS
      - Capture the main idea or purpose
      - Be descriptive and specific to the content type
      - Use sentence case (only capitalize the first word and proper nouns)
      - Don't use markdown, just plain text
      - Don't use punctuation
      - Use abbreviations or acronyms where appropriate
    </constraints>

    <context>
      <type>${request.type}</type>
      <content>${request.markdown}</content>
    </context>
    ${stabilityBlock}

    <examples>
      <example>
        <type>paragraph</type>
        <content>{"text": "This is a description of how our service works in detail."}</content>
        <output>Service explanation details</output>
      </example>

      <example>
        <type>button</type>
        <content>{"text": "Submit Form", "action": "submit"}</content>
        <output>Submit form button</output>
      </example>
    </examples>

    <format>
      Return only the summary text, nothing else.
    </format>
  `;
}

function pageSeoPrompt(request: {
  fullPath: string;
  blocks: { type: string; markdown: string }[];
  previousMetaTitle?: string | null;
  previousMetaDescription?: string | null;
}) {
  const stabilityBlock =
    request.previousMetaTitle || request.previousMetaDescription
      ? outdent`

      <previous_metadata>
        <metaTitle>${request.previousMetaTitle ?? ""}</metaTitle>
        <metaDescription>${request.previousMetaDescription ?? ""}</metaDescription>
      </previous_metadata>
      <stability_instruction>
        Metadata was previously generated for this page.
        Return the SAME metadata unless it is no longer accurate.
        Only change it if the page content has meaningfully changed.
      </stability_instruction>
    `
      : "";

  return outdent`
    <instruction>
      Generate SEO metadata for a web page.
    </instruction>

    <constraints>
      - metaTitle: under 60 characters, concise and descriptive. Use sentence case (only capitalize the first word and proper nouns). Do NOT include the site/brand name — it will be appended automatically. Do NOT use separators like "-", "|", or ":" to split the title into parts.
      - metaDescription: under 160 characters, compelling summary of the page
      - Be specific to the actual content, not generic
      - Don't use markdown, just plain text
    </constraints>

    <page>
      <path>${request.fullPath}</path>
      <blocks>${JSON.stringify(request.blocks)}</blocks>
    </page>
    ${stabilityBlock}
  `;
}

function imageMetadataPrompt(currentFilename: string) {
  return outdent`
    Analyze this image and generate metadata for it:
    - "filename": a clean, descriptive filename in kebab-case (no extension). The current filename is "${currentFilename}". If it's already human-readable and descriptive, keep it as-is (without the extension). Only rewrite it if it's gibberish, a random hash, or not meaningful (e.g. "IMG_2847", "DSC0042", "a7f3b2c9").
    - "alt": SEO-optimized alt text describing the image content. Be concise but descriptive (1 sentence max).
  `;
}
