import { createTemplate } from "camox/createTemplate";
import { block as navbarBlock } from "../blocks/navbar";
import { block as footerBlock } from "../blocks/footer";

const landingPageTemplate = createTemplate({
  id: "landing-page",
  title: "Landing page",
  description:
    "Use for the home page, or other pages that are designed to be the first introduction of your site to visitors",
  blocks: { navbar: navbarBlock, footer: footerBlock },
  component: LandingPageTemplate,
});

function LandingPageTemplate({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col">
      <landingPageTemplate.blocks.Navbar />
      <div className="flex-1">{children}</div>
      <landingPageTemplate.blocks.Footer />
    </main>
  );
}

export { landingPageTemplate as template };
