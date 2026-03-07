import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, Output } from "ai";
import { outdent } from "outdent";
import { z } from "zod";

if (!process.env.OPEN_ROUTER_API_KEY) {
  throw new Error("OPEN_ROUTER_API_KEY is not set");
}

export const openRouter = createOpenRouter({
  apiKey: process.env.OPEN_ROUTER_API_KEY,
});

type BlockDefinition = {
  blockId: string;
  title: string;
  description: string;
  contentSchema: unknown;
  settingsSchema?: unknown;
};

type GeneratedBlock = {
  type: string;
  content: Record<string, unknown>;
  settings?: Record<string, unknown>;
};

export async function generatePageDraft(options: {
  contentDescription: string;
  blockDefinitions: BlockDefinition[];
}) {
  const { contentDescription, blockDefinitions } = options;

  const blockDefsForPrompt = blockDefinitions.map((def) => ({
    blockId: def.blockId,
    title: def.title,
    description: def.description,
    contentSchema: def.contentSchema,
    ...(def.settingsSchema ? { settingsSchema: def.settingsSchema } : {}),
  }));

  const { text } = await generateText({
    model: openRouter.chat("google/gemini-3-flash-preview"),
    messages: [
      {
        role: "user",
        content: outdent`
          <instruction>
            Generate a page layout with blocks based on the user's description.
          </instruction>

          <available_blocks>
            ${JSON.stringify(blockDefsForPrompt)}
          </available_blocks>

          <page_description>
            ${contentDescription}
          </page_description>

          <output_format>
            Return a JSON array of blocks. Each block must have:
            - "type": the blockId from available_blocks
            - "content": an object matching the contentSchema for that block type
            - "settings" (optional): an object matching the settingsSchema for that block type, if it has one

            Only use blocks from available_blocks. Ensure content matches schema constraints (maxLength, etc.).
            For RepeatableObject fields (arrays), provide an array of objects matching the nested schema.
            For settings, pick values from the enum options or boolean values defined in the settingsSchema.
            For String fields, you may use markdown formatting: **bold** and *italic*.

            IMPORTANT: Return ONLY the raw JSON array. Do NOT wrap it in markdown code fences or any other formatting. The response must be valid JSON that can be parsed directly.
          </output_format>
        `,
      },
    ],
  });

  return JSON.parse(text) as GeneratedBlock[];
}

export async function generateImageMetadata(
  imageUrl: string,
  currentFilename: string,
) {
  const { output } = await generateText({
    model: openRouter.chat("google/gemini-2.5-flash-lite"),
    output: Output.object({
      schema: z.object({
        filename: z.string(),
        alt: z.string(),
      }),
    }),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            image: new URL(imageUrl),
          },
          {
            type: "text",
            text: outdent`
              Analyze this image and generate metadata for it:
              - "filename": a clean, descriptive filename in kebab-case (no extension). The current filename is "${currentFilename}". If it's already human-readable and descriptive, keep it as-is (without the extension). Only rewrite it if it's gibberish, a random hash, or not meaningful (e.g. "IMG_2847", "DSC0042", "a7f3b2c9").
              - "alt": SEO-optimized alt text describing the image content. Be concise but descriptive (1 sentence max).
            `,
          },
        ],
      },
    ],
  });

  return output;
}

type GenerateObjectSummaryOptions = {
  type: string;
  markdown: string;
  previousSummary?: string;
};
export async function generateObjectSummary(
  options: GenerateObjectSummaryOptions,
) {
  const stabilityBlock = options.previousSummary
    ? outdent`

      <previous_summary>${options.previousSummary}</previous_summary>
      <stability_instruction>
        A summary was previously generated for this content.
        Return the SAME summary unless it is no longer accurate.
        Only change it if the content has meaningfully changed.
      </stability_instruction>
    `
    : "";

  const { text: summary } = await generateText({
    model: openRouter.chat("openai/gpt-oss-20b"),
    messages: [
      {
        role: "user",
        content: outdent`
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
              <type>${options.type}</type>
              <content>${options.markdown}</content>
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
          `,
      },
    ],
  });

  return summary;
}

type GeneratePageSeoOptions = {
  fullPath: string;
  blocks: { type: string; markdown: string }[];
  previousMetaTitle?: string;
  previousMetaDescription?: string;
};

export async function generatePageSeo(options: GeneratePageSeoOptions) {
  const stabilityBlock =
    options.previousMetaTitle || options.previousMetaDescription
      ? outdent`

      <previous_metadata>
        <metaTitle>${options.previousMetaTitle ?? ""}</metaTitle>
        <metaDescription>${options.previousMetaDescription ?? ""}</metaDescription>
      </previous_metadata>
      <stability_instruction>
        Metadata was previously generated for this page.
        Return the SAME metadata unless it is no longer accurate.
        Only change it if the page content has meaningfully changed.
      </stability_instruction>
    `
      : "";

  const { output } = await generateText({
    model: openRouter.chat("google/gemini-3-flash-preview"),
    output: Output.object({
      schema: z.object({
        metaTitle: z.string(),
        metaDescription: z.string(),
      }),
    }),
    messages: [
      {
        role: "user",
        content: outdent`
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
            <path>${options.fullPath}</path>
            <blocks>${JSON.stringify(options.blocks)}</blocks>
          </page>
          ${stabilityBlock}
        `,
      },
    ],
  });

  return output;
}
