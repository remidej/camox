import type { LivePage } from "./livePages";

/** At most this many pages of a derived layout are listed; the sitemap lists them all. */
export const LLMS_TXT_DERIVED_LAYOUT_CAP = 100;

/** Text that can't break out of a list entry or a blockquote, whatever Markdown it holds. */
function escapeMarkdown(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\\`*_[\]<>]/g, "\\$&");
}

function markdownPath(page: LivePage): string {
  if (!page.hasMarkdown) return page.fullPath;
  return page.fullPath === "/" ? "/index.md" : `${page.fullPath}.md`;
}

/**
 * The website's index for LLMs, following llmstxt.org: the project's name, the home page's
 * description, then a section per layout, in the app's order, linking each page's Markdown.
 */
export function formatLlmsTxt({
  projectName,
  pages,
  layouts,
  url,
}: {
  projectName: string;
  pages: readonly LivePage[];
  layouts: readonly { id: string; title: string; kind: string }[];
  /** A path's absolute URL, with the runtime base path. */
  url: (path: string) => string;
}): string {
  const lines = [`# ${escapeMarkdown(projectName)}`];
  const summary = pages.find((page) => page.fullPath === "/")?.description;
  if (summary) lines.push("", `> ${escapeMarkdown(summary)}`);

  for (const layout of layouts) {
    const entries = pages
      .filter((page) => page.layoutId === layout.id)
      .sort((a, b) => (a.fullPath < b.fullPath ? -1 : a.fullPath > b.fullPath ? 1 : 0));
    if (entries.length === 0) continue;
    const cap = layout.kind === "derived" ? LLMS_TXT_DERIVED_LAYOUT_CAP : Infinity;
    lines.push("", `## ${escapeMarkdown(layout.title)}`, "");
    for (const page of entries.slice(0, cap)) {
      const description = page.description ? `: ${escapeMarkdown(page.description)}` : "";
      lines.push(`- [${escapeMarkdown(page.title)}](${url(markdownPath(page))})${description}`);
    }
    if (entries.length > cap)
      lines.push(
        `- [Sitemap](${url("/sitemap.xml")}): ${entries.length - cap} more ${escapeMarkdown(layout.title)} pages`,
      );
  }
  return `${lines.join("\n")}\n`;
}
