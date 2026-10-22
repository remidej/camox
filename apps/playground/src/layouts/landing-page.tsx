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
  toImage: ({ page, project }) => (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "flex-start",
        width: "100%",
        height: "100%",
        backgroundColor: "#09090b",
        padding: "60px 80px",
        fontFamily: "sans-serif",
      }}
    >
      {project.name && (
        <div
          style={{
            fontSize: 24,
            color: "#a1a1aa",
            marginBottom: 24,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          {project.name}
        </div>
      )}
      <div
        style={{
          fontSize: 64,
          fontWeight: 700,
          color: "#fafafa",
          lineHeight: 1.2,
          marginBottom: 24,
          maxWidth: "100%",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {page.title}
      </div>
      {page.description && (
        <div
          style={{
            fontSize: 28,
            color: "#a1a1aa",
            lineHeight: 1.5,
            maxWidth: "80%",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
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
