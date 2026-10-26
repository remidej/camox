import { createLayout } from "camox/createLayout";

import { block as footerBlock } from "../blocks/footer";
import { block as navbarBlock } from "../blocks/navbar";

const regularPageLayout = createLayout({
  id: "regular-page",
  title: "Regular page",
  description: "Use for standard content pages like About, Contact, or any non-landing page",
  blocks: {
    before: [navbarBlock],
    after: [footerBlock],
    initial: [() => import("../blocks/hero")],
  },
  toReact: RegularPageLayout,
  toTitle: ({ page, project }) => `${page.title} | ${project.name}`,
  toDescription: ({ page }) => page.description,
  // Styled with the Theme's utilities, like the blocks: page images render with src/styles.css.
  toImage: ({ page, project }) => (
    <div className="dark bg-canvas text-ink font-body flex h-full w-full flex-col justify-center px-20 py-16">
      {project.name && (
        <div className="text-brand mb-6 text-2xl font-semibold tracking-widest uppercase">
          {project.name}
        </div>
      )}
      <div className="font-heading mb-6 line-clamp-2 text-6xl leading-tight font-semibold tracking-tight">
        {page.title}
      </div>
      {page.description && (
        <div className="text-ink-muted line-clamp-2 max-w-4/5 text-3xl leading-normal">
          {page.description}
        </div>
      )}
    </div>
  ),
});

function RegularPageLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="dark bg-canvas text-ink flex min-h-screen flex-col">
      <regularPageLayout.BeforeBlocks />
      <div className="flex-1">{children}</div>
      <regularPageLayout.AfterBlocks />
    </main>
  );
}

export { regularPageLayout as layout };
