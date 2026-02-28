import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";
import { outdent } from "outdent";

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
}): Promise<GeneratedBlock[]> {
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
          </output_format>

          <response>
            Return ONLY the JSON array, no explanation or markdown.
          </response>
        `,
      },
    ],
  });

  // Extract JSON from response (handle potential markdown code blocks)
  let jsonStr = text.trim();
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr
      .replace(/```json?\n?/g, "")
      .replace(/```$/g, "")
      .trim();
  }

  return JSON.parse(jsonStr) as GeneratedBlock[];
}

export async function generateImageMetadata(
  imageUrl: string,
  currentFilename: string,
) {
  const { text } = await generateText({
    model: openRouter.chat("google/gemini-2.5-flash-lite"),
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
              Analyze this image and return a JSON object with two fields:
              - "filename": a clean, descriptive filename in kebab-case (no extension). The current filename is "${currentFilename}". If it's already human-readable and descriptive, keep it as-is (without the extension). Only rewrite it if it's gibberish, a random hash, or not meaningful (e.g. "IMG_2847", "DSC0042", "a7f3b2c9").
              - "alt": SEO-optimized alt text describing the image content. Be concise but descriptive (1 sentence max).

              Return ONLY the JSON object, no explanation or markdown.
            `,
          },
        ],
      },
    ],
  });

  let jsonStr = text.trim();
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr
      .replace(/```json?\n?/g, "")
      .replace(/```$/g, "")
      .trim();
  }

  return JSON.parse(jsonStr) as { filename: string; alt: string };
}

type GenerateObjectSummaryOptions = {
  type: string;
  content: string;
};
export async function generateObjectSummary(
  options: GenerateObjectSummaryOptions,
) {
  const { text: summary } = await generateText({
    model: openRouter.chat("mistralai/mistral-7b-instruct"),
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
              - Don't use markdown, just plain text
              - Don't use punctuation
              - Use abbreviations or acronyms where appropriate
            </constraints>

            <context>
              <type>${options.type}</type>
              <content>${JSON.stringify(options.content)}</content>
            </context>

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

