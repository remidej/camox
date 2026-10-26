import { createLayout } from "camox/createLayout";

import { block as footerBlock } from "../blocks/footer";
import { block as navbarBlock } from "../blocks/navbar";

const landingPageLayout = createLayout({
  id: "landing-page",
  title: "Landing page",
  description:
    "Use for the home page, or other pages that are designed to be the first introduction of your site to visitors",
  blocks: {
    before: [navbarBlock],
    after: [footerBlock],
    initial: [() => import("../blocks/hero"), () => import("../blocks/statistics")],
  },
  toReact: LandingPageLayout,
  toTitle: ({ page, project }) => `${project.name} | ${page.title}`,
  toDescription: ({ page }) => page.description,
  // Styled with the Theme's utilities, like the blocks: page images render with src/styles.css.
  toImage: ({ page, project }) => (
    <div className="brand bg-canvas text-ink font-body flex h-full w-full flex-col justify-center px-20 py-16">
      {project.name && (
        <div className="text-ink-muted mb-6 text-2xl font-semibold tracking-widest uppercase">
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

function LandingPageLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col">
      <landingPageLayout.BeforeBlocks />
      <div className="flex-1">{children}</div>
      <landingPageLayout.AfterBlocks />
    </main>
  );
}

export { landingPageLayout as layout };
