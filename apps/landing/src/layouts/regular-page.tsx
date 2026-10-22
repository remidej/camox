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
  component: RegularPageLayout,
  buildMetaTitle: ({ pageMetaTitle, projectName }) => `${pageMetaTitle} | ${projectName}`,
  buildOgImage: ({ title, description, projectName }) => (
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
      {projectName && (
        <div
          style={{
            fontSize: 24,
            color: "#a1a1aa",
            marginBottom: 24,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          {projectName}
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
        {title}
      </div>
      {description && (
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
          {description}
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
