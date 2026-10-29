import { LOOK_TOOL } from "@camox/api-contract/threads";
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";

import type { ToolInvocation } from "../threads/tools";
import { type CaptureChecks, LOOK_SIZES } from "./capture";
import { LOOK_IMAGE_CAP, LOOK_MAX_DELAY_MS, type Looked, type LookTarget } from "./look";

const SIZE = Type.Union(
  Object.keys(LOOK_SIZES).map((size) => Type.Literal(size)),
  {
    description: Object.entries(LOOK_SIZES)
      .map(([size, { width }]) => `\`${size}\` is ${width} pixels wide`)
      .join(", "),
  },
);

/** How any target is captured: at which sizes, and when. */
const CAPTURE_OPTIONS = {
  sizes: Type.Optional(
    Type.Array(SIZE, { minItems: 1, description: "The sizes to capture: both by default." }),
  ),
  // No maximum here: a longer delay fails its own target, not the whole call.
  delay: Type.Optional(
    Type.Number({
      description:
        "How long to wait before capturing, in milliseconds, at most " +
        `${LOOK_MAX_DELAY_MS}. The capture already waits for the page and its Artifacts to ` +
        "load, then a short settle for entrance animations: delay only to see an animation " +
        "at a later moment.",
    }),
  ),
};

/**
 * A page of the draft, captured as a visitor sees it: its first screen. With a block, one
 * Placement on it: the page renders whole, its Layout and neighbours included, and the capture is
 * that block's element.
 */
const PAGE_TARGET = Type.Object({
  path: Type.String({
    description:
      "The page's path in its Locale, such as `/pricing`: a curated page, a Singleton " +
      "Layout's page, or a page of a Derived Layout, such as `/blog/my-post`.",
  }),
  block: Type.Optional(
    Type.String({
      description:
        "The ID of one block on that page, its Layout's included, to capture that block alone " +
        "instead of the first screen. Its capture stops at two screens tall.",
    }),
  ),
  locale: Type.Optional(
    Type.String({ description: "The Locale's tag, such as `fr`. The Default Locale without." }),
  ),
  ...CAPTURE_OPTIONS,
});

/**
 * A Block Definition's block, placed nowhere, captured alone in the site's shell: up to two
 * screens of it.
 */
const BLOCK_DEFINITION_TARGET = Type.Object({
  blockDefinition: Type.String({
    description:
      "The Block Definition's name. Its default content and Block Settings show, with the " +
      "overrides below merged on. Nothing editors see changes.",
  }),
  content: Type.Optional(
    Type.Unknown({
      description:
        "Content overrides, as `createBlock` takes a block's content: fields by name, " +
        "Repeatable Items as arrays, Files and Collection Records of the draft by id.",
    }),
  ),
  settings: Type.Optional(
    Type.Unknown({ description: "Block Setting overrides, by name, such as a Color Scheme." }),
  ),
  ...CAPTURE_OPTIONS,
});

/**
 * What one result says beside its image, as a line of JSON: the target it captured, at which
 * size, and whether its image was cut, or why it failed.
 */
const resultLine = ({ target: { sizes: _sizes, ...target }, size, ...captured }: Looked) =>
  JSON.stringify({
    ...target,
    size,
    ...("error" in captured ? { error: captured.error } : captured.cut ? { cut: true } : {}),
  });

const listed = (heading: string, items: string[]) =>
  items.length ? [`${heading}:`, ...items.map((item) => `- ${item}`)] : [];

/**
 * What the page reported beside its image, which the image can't show, as text: only what it
 * found, or one line saying it found nothing.
 */
const reportChecks = ({ errors, failedRequests, overflow }: CaptureChecks) => {
  const lines = [
    ...listed("Console and page errors", errors),
    ...(overflow ? ["Content overflows horizontally at this width."] : []),
    ...listed("Failed requests", failedRequests),
  ];
  return lines.length
    ? lines.join("\n")
    : "No console or page errors, overflow or failed requests.";
};

/**
 * The agent's `look`, which captures pages of its draft in a real browser and returns the images,
 * which the model reads. `look` runs it for the call: the thread knows its draft and run.
 */
export const lookTool = (
  look: (targets: LookTarget[], invocation: ToolInvocation) => Promise<Looked[]>,
) =>
  defineTool({
    name: LOOK_TOOL,
    description:
      "See the draft as visitors will, in a real browser, at each target's sizes. A target is " +
      "a page, curated or of a Singleton or Derived Layout, captured at its first screen; one block on a page, captured with the page " +
      "around it; or a Block Definition, captured alone, with overrides to try its variants " +
      "and edge cases. Look at all you need in one call: its targets render in parallel, at " +
      `most ${LOOK_IMAGE_CAP} images per call. Content shows as the draft has it now; code ` +
      "shows as the draft's preview has it, so after code changes call `build` first. " +
      "Returns, for each target and size, a line of JSON naming it, then either what the page " +
      "reported that the image can't show (console and page errors, horizontal overflow, " +
      "failed requests) and the image, or the `error` that target alone hit. `cut` says a " +
      "block was taller than two screens: its image shows the top only.",
    parameters: Type.Object({
      targets: Type.Array(Type.Union([PAGE_TARGET, BLOCK_DEFINITION_TARGET]), { minItems: 1 }),
    }),
    async execute({ targets }, api, context) {
      const looked = await look(targets as LookTarget[], { api, context });
      return {
        output: looked.flatMap((result) => [
          { type: "text" as const, text: resultLine(result) },
          ...("image" in result
            ? [
                { type: "text" as const, text: reportChecks(result.checks) },
                { type: "image" as const, ...result.image },
              ]
            : []),
        ]),
      };
    },
  });
