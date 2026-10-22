import { createLayout } from "camox/createLayout";

import { block as articlesIndexBlock } from "../blocks/articles-index";
import { block as footerBlock } from "../blocks/footer";
import { block as navbarBlock } from "../blocks/navbar";

export const Layout = createLayout("articles")({
  kind: "singleton",
  title: "Articles",
  description: "The articles index, listing every article with a link to its record page.",
  blocks: { before: [navbarBlock, articlesIndexBlock], after: [footerBlock] },
  toTitle: ({ page, project }) => `${page.title} | ${project.name}`,
  toDescription: ({ page }) => page.description,
  toReact: ArticlesPage,
});

function ArticlesPage() {
  return (
    <div className="bg-canvas text-ink flex min-h-screen flex-col">
      <Layout.BeforeBlocks />
      <div className="flex-1" />
      <Layout.AfterBlocks />
    </div>
  );
}
