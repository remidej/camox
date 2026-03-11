import { createLayout } from "camox/createLayout";
import { block as navbarBlock } from "../blocks/navbar";
import { block as footerBlock } from "../blocks/footer";

const landingPageLayout = createLayout({
  id: "landing-page",
  title: "Landing page",
  description:
    "Use for the home page, or other pages that are designed to be the first introduction of your site to visitors",
  blocks: { before: [navbarBlock], after: [footerBlock] },
  component: LandingPageLayout,
  buildMetaTitle: ({ pageMetaTitle, projectName }) =>
    `${projectName} | ${pageMetaTitle}`,
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

function LandingPageLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col">
      <landingPageLayout.blocks.Navbar />
      <div className="flex-1">{children}</div>
      <landingPageLayout.blocks.Footer />
    </main>
  );
}

export { landingPageLayout as layout };
