import { LOOK_TOOL } from "@camox/api-contract/threads";
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";

import type { ToolInvocation } from "../threads/tools";
import { LOOK_SIZES } from "./capture";
import { LOOK_IMAGE_CAP, type Looked, type LookTarget } from "./look";

const SIZE = Type.Union(
  Object.keys(LOOK_SIZES).map((size) => Type.Literal(size)),
  {
    description: Object.entries(LOOK_SIZES)
      .map(([size, { width }]) => `\`${size}\` is ${width} pixels wide`)
      .join(", "),
  },
);

const SIZES = Type.Optional(
  Type.Array(SIZE, { minItems: 1, description: "The sizes to capture: both by default." }),
);

/** A page of the draft, captured as a visitor sees it: its first screen. */
const PAGE_TARGET = Type.Object({
  path: Type.String({ description: "The page's path in its Locale, such as `/pricing`." }),
  locale: Type.Optional(
    Type.String({ description: "The Locale's tag, such as `fr`. The Default Locale without." }),
  ),
  sizes: SIZES,
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
  sizes: SIZES,
});

/**
 * What one result says beside its image, as a line of JSON: the target it captured, at which
 * size, or why it failed.
 */
const describe = ({ target: { sizes: _sizes, ...target }, size, ...captured }: Looked) =>
  JSON.stringify({ ...target, size, ...("error" in captured ? { error: captured.error } : {}) });

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
      "at each of its sizes. A target can also be a Block Definition, alone, to try its " +
      "variants and edge cases with overrides. The draft's content shows as it is now; code " +
      "shows as the draft's " +
      "preview has it, so after code changes call `build` first. Returns, for each target and " +
      "size, a line of JSON naming it, followed by its image, or with the `error` that target " +
      `alone hit. At most ${LOOK_IMAGE_CAP} images per call.`,
    parameters: Type.Object({
      targets: Type.Array(Type.Union([PAGE_TARGET, BLOCK_DEFINITION_TARGET]), { minItems: 1 }),
    }),
    async execute({ targets }, api, context) {
      const looked = await look(targets as LookTarget[], { api, context });
      return {
        output: looked.flatMap((result) => [
          { type: "text" as const, text: describe(result) },
          ...("image" in result ? [{ type: "image" as const, ...result.image }] : []),
        ]),
      };
    },
  });
