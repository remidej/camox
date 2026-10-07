import { createBlock } from "camox/createBlock";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";

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
    <section className="bg-background py-24">
      <div className="container mx-auto px-4">
        <div className="mx-auto flex max-w-5xl flex-col lg:flex-row lg:items-center lg:gap-16">
          <downloadWhitebook.Image name="cover">
            {(props) => (
              <img
                {...props}
                className="mb-10 w-full max-w-xs rounded-lg shadow-lg lg:mb-0 lg:max-w-sm"
              />
            )}
          </downloadWhitebook.Image>
          <div className="flex-1">
            <downloadWhitebook.Field name="title">
              {(props) => (
                <h2
                  {...props}
                  className="text-foreground mb-4 text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl"
                />
              )}
            </downloadWhitebook.Field>
            <downloadWhitebook.Field name="description">
              {(props) => (
                <p {...props} className="text-muted-foreground mb-8 text-lg leading-relaxed" />
              )}
            </downloadWhitebook.Field>
            <downloadWhitebook.File name="file">
              {(fileProps) => (
                <downloadWhitebook.Field name="cta">
                  {(ctaProps) => (
                    <Button
                      size="lg"
                      nativeButton={false}
                      render={<a {...fileProps} {...ctaProps} />}
                    >
                      <Download className="mr-2 h-5 w-5" />
                      {ctaProps.children}
                    </Button>
                  )}
                </downloadWhitebook.Field>
              )}
            </downloadWhitebook.File>
          </div>
        </div>
      </div>
    </section>
  );
}

export { downloadWhitebook as block };
