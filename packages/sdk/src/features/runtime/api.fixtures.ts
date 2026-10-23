import { type LocalePath, parseLocalePath } from "../../lib/locale-path";

/** A Markdown Representation without its front matter. */
export function markdownBody(markdown: string) {
  return markdown.replace(/^---\n[\s\S]*?\n---\n\n/, "");
}

/** The API's answer to `pages.listBySlug`: the project's name and its pages. */
export function pageListResponse(pages: readonly unknown[] = [], projectName = "Test project") {
  return Response.json({ json: { projectName, pages } });
}

/** The API's answer to `locales.list`: the scope's locales by tag, the default locale first. */
export function localesResponse(tags: readonly string[] = ["en"]) {
  return Response.json({ json: tags.map((tag, index) => ({ tag, isDefault: index === 0 })) });
}

/** The curated page a `pages.getMarkdown` answer holds: the page, its layout and Markdown. */
export interface MarkdownPage {
  page: Record<string, unknown>;
  layout?: { layoutId: string } | null;
  projectName?: string;
  markdown: string;
}

/**
 * The API's answer to `pages.getMarkdown` for the runtime path `request` names: the locale its
 * prefix names among `tags`, the default locale first, the path in that locale, and the page
 * `pageAt` finds there, if any.
 */
export async function pageMarkdownResponse(
  request: Request,
  {
    tags = ["en"],
    pageAt = () => undefined,
  }: {
    tags?: readonly string[];
    pageAt?: (located: LocalePath) => MarkdownPage | null | undefined;
  } = {},
) {
  const { json } = (await request.clone().json()) as { json: { path: string } };
  const located = parseLocalePath(
    json.path,
    tags.map((tag, index) => ({ tag, isDefault: index === 0 })),
  );
  const found = pageAt(located);
  return Response.json({
    json: {
      ...located,
      page: found?.page ?? null,
      layout: found ? (found.layout ?? null) : null,
      projectName: found?.projectName ?? "Test project",
      markdown: found?.markdown ?? "",
    },
  });
}
