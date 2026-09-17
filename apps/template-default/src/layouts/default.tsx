import { createLayout } from "camox/createLayout";

import { block as faqBlock } from "../blocks/faq";
import { block as footerBlock } from "../blocks/footer";
import { block as heroBlock } from "../blocks/hero";
import { block as navbarBlock } from "../blocks/navbar";

const defaultLayout = createLayout({
  id: "default",
  title: "Default",
  description: "Default page layout with a navbar and footer",
  blocks: {
    before: [navbarBlock],
    after: [footerBlock],
    initial: [heroBlock, faqBlock],
  },
  component: DefaultLayout,
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

function DefaultLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col">
      <defaultLayout.BeforeBlocks />
      <div className="flex-1">{children}</div>
      <defaultLayout.AfterBlocks />
    </main>
  );
}

export { defaultLayout as layout };
