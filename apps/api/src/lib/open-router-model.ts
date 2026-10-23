import { chat } from "@tanstack/ai";
import { createOpenRouterText } from "@tanstack/ai-openrouter";
import { Effect } from "effect";
import { outdent } from "outdent";
import { z } from "zod";

import { readMetadataImage } from "../domains/files/metadata-image";
import {
  AiModel,
  type DraftOverviewRequest,
  type MergeRequest,
  type TranslationContext,
  type TranslationRequest,
} from "./ai-model";
import { transformImageUrl } from "./image-transform";
import { retryAiCall } from "./retry-ai-call";

/**
 * Writes every generated value. Chosen in October 2026 after running these prompts
 * across 17 models: it followed every format rule on all three jobs.
 */
const MODEL = "google/gemini-3.1-flash-lite";

/** The model that writes generated values and translations, through OpenRouter. */
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
          }).then((result) => result.text),
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
                    { type: "text" as const, content: imageMetadataPrompt(request) },
                  ],
                },
              ],
            }),
          );
        }),
      ),

    translate: (request) =>
      retryAiCall("translation", (abortController) =>
        Effect.promise(() =>
          chat({
            adapter: createOpenRouterText(MODEL, apiKey),
            abortController,
            outputSchema: z.object({
              translations: z.array(z.object({ key: z.string(), text: z.string() })),
            }),
            messages: [{ role: "user", content: translationPrompt(request) }],
          }),
        ).pipe(Effect.map(({ translations }) => byAskedKey(request.texts, translations))),
      ),

    merge: (request) =>
      retryAiCall("merge", (abortController) =>
        Effect.promise(() =>
          chat({
            adapter: createOpenRouterText(MODEL, apiKey),
            abortController,
            outputSchema: z.object({
              merges: z.array(z.object({ key: z.string(), text: z.string() })),
            }),
            messages: [{ role: "user", content: mergePrompt(request) }],
          }),
        ).pipe(Effect.map(({ merges }) => byAskedKey(request.texts, merges))),
      ),

    draftOverview: (request) =>
      retryAiCall("draftOverview", (abortController) =>
        Effect.promise(() =>
          chat({
            adapter: createOpenRouterText(MODEL, apiKey),
            abortController,
            outputSchema: z.object({ headline: z.string(), bullets: z.array(z.string()) }),
            messages: [{ role: "user", content: draftOverviewPrompt(request) }],
          }),
        ),
      ),
  });

/** The answered texts by key: only keys the request asked for count, a missing key keeps its text. */
function byAskedKey(asked: readonly { key: string }[], answered: { key: string; text: string }[]) {
  const keys = new Set(asked.map(({ key }) => key));
  return Object.fromEntries(
    answered.filter(({ key }) => keys.has(key)).map(({ key, text }) => [key, text]),
  );
}

/**
 * How a translation reads: as the website's audience writes in the target locale, not word for
 * word. People in a field often say an English term rather than its dictionary translation.
 */
const LOCALIZATION_CONSTRAINTS = (to: string) => outdent`
  - Write the way the website's audience writes in the "${to}" locale, given what the website is about. Use the words they actually use: where they say an English term rather than its translation (as French developers say "token" and "codebase", not "jeton" and "base de code"), use the English term too
  - Carry over the meaning and tone, not the wording: rephrase freely wherever a close translation would sound unnatural to them
  - Keep brand and product names, code, URLs and placeholders such as {{name}} as they are
`;

/** What the model is told about the website, when anything is known. */
function websiteBlock(context: TranslationContext) {
  const lines = [
    context.website && `<name>${context.website}</name>`,
    context.pageTitle && `<page_title>${context.pageTitle}</page_title>`,
    context.pageDescription && `<page_description>${context.pageDescription}</page_description>`,
  ].filter(Boolean);
  if (lines.length === 0) return "";
  return outdent`

    <website>
      ${lines.join("\n  ")}
    </website>
    The website's name and the page the texts are on, for context only: don't translate them.
  `;
}

const FORMAT_CONSTRAINTS = outdent`
  - "plain" texts: return plain text, without markdown
  - "html" texts: an HTML document; translate only the words people read, including titles and attributes such as alt, title and aria-label, and keep every tag, attribute name, script and style as it is
  - "slug" texts: a URL path segment; return a translated segment in lowercase kebab-case, ASCII only, without slashes
`;

function mergePrompt(request: MergeRequest) {
  return outdent`
    <instruction>
      A website is translated from the "${request.from}" locale into the "${request.to}" locale (BCP 47 tags). Someone edited some translated texts by hand, and their source has changed since. For each text, write the "${request.to}" text that keeps the hand edit's intent and carries over what changed in the source.
    </instruction>
    ${websiteBlock(request.context)}

    <inputs>
      - "previousSource": the source text when it was last translated
      - "previousTranslation": the translation written from it then
      - "source": the source text now
      - "current": the translation now, as edited by hand
    </inputs>

    <constraints>
      - Return one text per input, under its key, in the "${request.to}" locale
      - Keep what the hand edit changed in "current", unless the source's change replaces it
      ${LOCALIZATION_CONSTRAINTS(request.to)}
      ${FORMAT_CONSTRAINTS}
      - "markdown" texts: rich text as Markdown; return Markdown, keeping its paragraphs, bold and italic, and every link's target as it is
    </constraints>

    <texts>${JSON.stringify(request.texts)}</texts>
  `;
}

function translationPrompt(request: TranslationRequest) {
  return outdent`
    <instruction>
      Translate each text of a website from the "${request.from}" locale into the "${request.to}" locale (BCP 47 tags), so it reads as if it had been written in "${request.to}" in the first place.
    </instruction>
    ${websiteBlock(request.context)}

    <constraints>
      - Return one translation per text, under the text's key
      ${LOCALIZATION_CONSTRAINTS(request.to)}
      ${FORMAT_CONSTRAINTS}
    </constraints>

    <texts>${JSON.stringify(request.texts)}</texts>
  `;
}

function draftOverviewPrompt(request: DraftOverviewRequest) {
  return outdent`
    <instruction>
      A draft is a set of changes to a website, reviewed by its editors before it's published. Describe what this draft does, for an editor about to review it.
    </instruction>

    <constraints>
      - "headline": one sentence about what the draft does as a whole, not a list of its changes
      - "bullets": one bullet per page or category of content, together covering every change
      - Group many similar changes into one bullet with a count ("12 blog posts get new SEO") rather than dropping any
      - Mention removals as well as additions and edits
      - Name pages by their name or path, and blocks, records and files by what they are to people
      - Plain English, without markdown, technical terms or ids
      - Say what changed using the values: "Pro goes from $29 to $20" rather than "Pricing plans changed"
      - A change "moved" only changed its position on its page
      - A page with "pagesUnder" changed its path, and so did that many pages under it: mention it once
      - "localeEdits" are edits made by hand in other languages: summarize them per language
      - When the changes come as "places", there are too many to list: describe each place from its counts
      - A place such as "12 other places" stands for that many places together, too many to list
    </constraints>

    <draft>
      <name>${request.draftName ?? ""}</name>
      ${"changes" in request ? `<changes>${JSON.stringify(request.changes)}</changes>` : `<places>${JSON.stringify(request.places)}</places>`}
      <localeEdits>${JSON.stringify(request.localeEdits)}</localeEdits>
    </draft>
  `;
}

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
  locale: string;
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
      - Write both in the language of the locale ${request.locale}, whatever the language of the content
    </constraints>

    <page>
      <path>${request.fullPath}</path>
      <blocks>${JSON.stringify(request.blocks)}</blocks>
    </page>
    ${stabilityBlock}
  `;
}

function imageMetadataPrompt(request: { locale: string; filename: string }) {
  return outdent`
    Analyze this image and generate metadata for it:
    - "filename": a clean, descriptive filename in kebab-case (no extension). The current filename is "${request.filename}". If it's already human-readable and descriptive, keep it as-is (without the extension). Only rewrite it if it's gibberish, a random hash, or not meaningful (e.g. "IMG_2847", "DSC0042", "a7f3b2c9").
    - "alt": SEO-optimized alt text describing the image content. Be concise but descriptive (1 sentence max). Write it in the language of the locale ${request.locale}.
  `;
}
