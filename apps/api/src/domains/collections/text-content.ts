import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";

import { InvalidInputError } from "../../lib/errors";
import { isLexicalState, lexicalStateToPlainText } from "../../lib/lexical-state";
import { pages } from "../../schema";
import type { ServiceContext } from "../_shared/service-context";

// The nodes currently registered by Camox's inline/sidebar text editors.
const nodeInput = z
  .object({
    type: z.enum(["root", "paragraph", "inline-paragraph", "text", "linebreak", "link"]),
    version: z.literal(1),
    children: z.array(z.unknown()).optional(),
    text: z.string().optional(),
    direction: z.enum(["ltr", "rtl"]).nullable().optional(),
    format: z.union([z.number().int().nonnegative(), z.string()]).optional(),
    indent: z.number().int().nonnegative().optional(),
    detail: z.number().int().optional(),
    mode: z.enum(["normal", "token", "segmented"]).optional(),
    style: z.string().optional(),
    textFormat: z.number().int().optional(),
    textStyle: z.string().optional(),
    url: z.string().optional(),
    rel: z.string().nullable().optional(),
    target: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
  })
  .strict();

/** Collection content shape errors surface as one readable input error. */
export function decodeContent<S extends z.ZodType>(schema: S, value: unknown) {
  const result = schema.safeParse(value);
  if (result.success) return Effect.succeed(result.data as z.output<S>);
  return Effect.fail(
    new InvalidInputError({
      message: `Invalid collection content: ${result.error.issues.map((issue) => issue.message).join("; ")}`,
    }),
  );
}

/** Preserve existing authored text, not HTML and not an unvalidated arbitrary object. */
export const validateText = Effect.fn("collections.validateText")(function* (
  ctx: ServiceContext,
  scope: { projectId: number; environmentId: number },
  value: unknown,
) {
  if (typeof value === "string" && !isLexicalState(value)) return { value, text: value };
  const state = yield* decodeContent(
    z.object({ root: z.unknown() }).strict(),
    typeof value === "string" ? JSON.parse(value) : value,
  );
  let count = 0;
  const walk = Effect.fn(function* (
    value: unknown,
    parent: string | null,
    depth: number,
  ): Effect.fn.Return<void, InvalidInputError> {
    if (depth > 32 || ++count > 10000)
      return yield* new InvalidInputError({ message: "Text state is too large" });
    const node = yield* decodeContent(nodeInput, value);
    if ((parent === null) !== (node.type === "root"))
      return yield* new InvalidInputError({ message: "Invalid text root" });
    if (parent === "root" && !["paragraph", "inline-paragraph"].includes(node.type)) {
      return yield* new InvalidInputError({ message: "Text root requires paragraphs" });
    }
    if (parent && parent !== "root" && !["text", "linebreak", "link"].includes(node.type)) {
      return yield* new InvalidInputError({ message: "Invalid inline text node" });
    }
    if (parent === "link" && node.type === "link")
      return yield* new InvalidInputError({ message: "Nested text links are invalid" });
    if (node.type === "text") {
      if (
        node.text === undefined ||
        node.children ||
        (node.format !== undefined && typeof node.format !== "number")
      ) {
        return yield* new InvalidInputError({ message: "Malformed text node" });
      }
      return;
    }
    if (node.type === "linebreak") {
      if (node.children) return yield* new InvalidInputError({ message: "Malformed linebreak" });
      return;
    }
    if (!node.children)
      return yield* new InvalidInputError({ message: "Text container requires children" });
    if (node.type === "link") {
      const url = yield* decodeContent(z.string(), node.url);
      if (url.startsWith("camox:page:")) {
        const id = yield* decodeContent(
          z.coerce.number().int().positive(),
          url.slice("camox:page:".length),
        );
        const page = yield* Effect.promise(() =>
          ctx.db
            .select({ id: pages.id })
            .from(pages)
            .where(
              and(
                eq(pages.id, id),
                eq(pages.projectId, scope.projectId),
                eq(pages.environmentId, scope.environmentId),
              ),
            )
            .get(),
        );
        if (!page)
          return yield* new InvalidInputError({
            message: "Text link is outside this site/environment",
          });
      } else if (
        !/^https?:\/\/[^\s\\\p{Cc}]+$/u.test(url) &&
        !/^\/(?!\/)[^\s\\\p{Cc}]*$/u.test(url)
      ) {
        return yield* new InvalidInputError({ message: "Unsafe text link" });
      }
    }
    for (const child of node.children) yield* walk(child, node.type, depth + 1);
  });
  yield* walk(state.root, null, 0);
  return { value: state, text: lexicalStateToPlainText(state) };
});
