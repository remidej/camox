import { createBlock } from "camox/createBlock";
import { Download } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";

const downloadWhitebook = createBlock({
  id: "download-whitebook",
  title: "Download Whitebook",
  description:
    "Use this block to offer a downloadable PDF whitebook or whitepaper. It displays a cover image alongside a title, description, and a download button. Ideal for lead magnets, research papers, guides, or any downloadable document you want to highlight.",
  content: (field) => ({
    title: field.string({
      default: "Download our whitebook",
      title: "Title",
    }),
    description: field.string({
      default:
        "Get our comprehensive guide packed with insights, best practices, and actionable strategies.",
      maxLength: 280,
      title: "Description",
    }),
    cover: field.image({
      title: "Cover",
    }),
    file: field.file({
      accept: ["application/pdf"],
      title: "PDF File",
    }),
    cta: field.string({
      default: "Download PDF",
      maxLength: 40,
      title: "Button Label",
    }),
  }),
  component: DownloadWhitebookComponent,
  toMarkdown: (c) => [`## ${c.title}`, c.description, c.cover, c.file],
});

function DownloadWhitebookComponent() {
  return (
    <Section scheme="light">
      <Container>
        <div className="mx-auto flex max-w-5xl flex-col lg:flex-row lg:items-center lg:gap-16">
          <downloadWhitebook.Image name="cover">
            {(props) => (
              <img
                {...props}
                className="rounded-card mb-10 w-full max-w-xs shadow-lg lg:mb-0 lg:max-w-sm"
              />
            )}
          </downloadWhitebook.Image>
          <div className="flex-1">
            <downloadWhitebook.Field name="title">
              {(props) => <h2 {...props} className="text-heading mb-4" />}
            </downloadWhitebook.Field>
            <downloadWhitebook.Field name="description">
              {(props) => <p {...props} className="text-lead text-ink-muted mb-8" />}
            </downloadWhitebook.Field>
            <downloadWhitebook.File name="file">
              {(fileProps) => (
                <downloadWhitebook.Field name="cta">
                  {(ctaProps) => (
                    // A plain <a>: the file's URL is a download, not a page of the site.
                    <a {...fileProps} {...ctaProps} className={buttonVariants({ size: "lg" })}>
                      <Download className="size-5" />
                      {ctaProps.children}
                    </a>
                  )}
                </downloadWhitebook.Field>
              )}
            </downloadWhitebook.File>
          </div>
        </div>
      </Container>
    </Section>
  );
}

export { downloadWhitebook as block };
