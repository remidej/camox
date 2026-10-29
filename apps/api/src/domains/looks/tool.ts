import { LOOK_TOOL } from "@camox/api-contract/threads";
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";

import type { ToolInvocation } from "../threads/tools";
import { type CaptureChecks, LOOK_SIZES } from "./capture";
import { LOOK_IMAGE_CAP, type Looked, type LookTarget } from "./look";

const SIZE = Type.Union(
  Object.keys(LOOK_SIZES).map((size) => Type.Literal(size)),
  {
    description: Object.entries(LOOK_SIZES)
      .map(([size, { width }]) => `\`${size}\` is ${width} pixels wide`)
      .join(", "),
  },
);

/**
 * A page of the draft, captured as a visitor sees it: its first screen. With a block, one
 * Placement on it: the page renders whole, its Layout and neighbours included, and the capture is
 * that block's element.
 */
const PAGE_TARGET = Type.Object({
  path: Type.String({ description: "The page's path in its Locale, such as `/pricing`." }),
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
  sizes: Type.Optional(
    Type.Array(SIZE, { minItems: 1, description: "The sizes to capture: both by default." }),
  ),
});

/**
 * What one result says beside its image, as a line of JSON: the target it captured, at which
 * size, and whether its image was cut, or why it failed.
 */
const describe = ({ target: { sizes: _sizes, ...target }, size, ...captured }: Looked) =>
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
      "See pages of the draft as visitors will, in a real browser: each target's first screen, " +
      "or one block of it, at each of its sizes. The draft's content shows as it is now; code shows as the draft's " +
      "preview has it, so after code changes call `build` first. Returns, for each target and " +
      "size, a line of JSON naming it, followed by what the page reported that the image can't " +
      "show (console and page errors, horizontal overflow, failed requests) and its image, or " +
      "with the `error` that target alone hit. `cut` says a block was taller than two screens " +
      `and shows its top only. At most ${LOOK_IMAGE_CAP} images per call.`,
    parameters: Type.Object({ targets: Type.Array(PAGE_TARGET, { minItems: 1 }) }),
    async execute({ targets }, api, context) {
      const looked = await look(targets as LookTarget[], { api, context });
      return {
        output: looked.flatMap((result) => [
          { type: "text" as const, text: describe(result) },
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
