import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

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

/** Preserve existing authored text, not HTML and not an unvalidated arbitrary object. */
export async function validateText(
  ctx: ServiceContext,
  scope: { projectId: number; environmentId: number },
  value: unknown,
) {
  if (typeof value === "string" && !isLexicalState(value)) return { value, text: value };
  const state = z
    .object({ root: z.unknown() })
    .strict()
    .parse(typeof value === "string" ? JSON.parse(value) : value);
  let count = 0;
  async function walk(value: unknown, parent: string | null, depth: number): Promise<void> {
    if (depth > 32 || ++count > 10000)
      throw new ORPCError("BAD_REQUEST", { message: "Text state is too large" });
    const node = nodeInput.parse(value);
    if ((parent === null) !== (node.type === "root"))
      throw new ORPCError("BAD_REQUEST", { message: "Invalid text root" });
    if (parent === "root" && !["paragraph", "inline-paragraph"].includes(node.type)) {
      throw new ORPCError("BAD_REQUEST", { message: "Text root requires paragraphs" });
    }
    if (parent && parent !== "root" && !["text", "linebreak", "link"].includes(node.type)) {
      throw new ORPCError("BAD_REQUEST", { message: "Invalid inline text node" });
    }
    if (parent === "link" && node.type === "link")
      throw new ORPCError("BAD_REQUEST", { message: "Nested text links are invalid" });
    if (node.type === "text") {
      if (
        node.text === undefined ||
        node.children ||
        (node.format !== undefined && typeof node.format !== "number")
      ) {
        throw new ORPCError("BAD_REQUEST", { message: "Malformed text node" });
      }
      return;
    }
    if (node.type === "linebreak") {
      if (node.children) throw new ORPCError("BAD_REQUEST", { message: "Malformed linebreak" });
      return;
    }
    if (!node.children)
      throw new ORPCError("BAD_REQUEST", { message: "Text container requires children" });
    if (node.type === "link") {
      const url = z.string().parse(node.url);
      if (url.startsWith("camox:page:")) {
        const id = z.coerce.number().int().positive().parse(url.slice("camox:page:".length));
        const page = await ctx.db
          .select({ id: pages.id })
          .from(pages)
          .where(
            and(
              eq(pages.id, id),
              eq(pages.projectId, scope.projectId),
              eq(pages.environmentId, scope.environmentId),
            ),
          )
          .get();
        if (!page)
          throw new ORPCError("BAD_REQUEST", {
            message: "Text link is outside this site/environment",
          });
      } else if (
        !/^https?:\/\/[^\s\\\p{Cc}]+$/u.test(url) &&
        !/^\/(?!\/)[^\s\\\p{Cc}]*$/u.test(url)
      ) {
        throw new ORPCError("BAD_REQUEST", { message: "Unsafe text link" });
      }
    }
    for (const child of node.children) await walk(child, node.type, depth + 1);
  }
  await walk(state.root, null, 0);
  return { value: state, text: lexicalStateToPlainText(state) };
}
