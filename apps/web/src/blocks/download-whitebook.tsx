import { Type, createBlock } from "camox/createBlock";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

const downloadWhitebook = createBlock({
  id: "download-whitebook",
  title: "Download Whitebook",
  description:
    "Use this block to offer a downloadable PDF whitebook or whitepaper. It displays a cover image alongside a title, description, and a download button. Ideal for lead magnets, research papers, guides, or any downloadable document you want to highlight.",
  content: {
    title: Type.String({
      default: "Download our whitebook",
      title: "Title",
    }),
    description: Type.String({
      default:
        "Get our comprehensive guide packed with insights, best practices, and actionable strategies.",
      maxLength: 280,
      title: "Description",
    }),
    cover: Type.Image({
      title: "Cover",
    }),
    file: Type.File({
      accept: ["application/pdf"],
      title: "PDF File",
    }),
    cta: Type.String({
      default: "Download PDF",
      maxLength: 40,
      title: "Button Label",
    }),
  },
  component: DownloadWhitebookComponent,
});

function DownloadWhitebookComponent() {
  return (
    <section className="py-24 bg-background">
      <div className="container mx-auto px-4">
        <div className="max-w-5xl mx-auto flex flex-col lg:flex-row lg:items-center lg:gap-16">
          <downloadWhitebook.Image name="cover">
            {(img) => (
              <img
                src={img.url}
                alt={img.alt}
                className="w-full max-w-xs lg:max-w-sm rounded-lg shadow-lg mb-10 lg:mb-0"
              />
            )}
          </downloadWhitebook.Image>
          <div className="flex-1">
            <downloadWhitebook.Field name="title">
              {(content) => (
                <h2 className="mb-4 text-3xl font-bold tracking-tight text-foreground sm:text-4xl lg:text-5xl">
                  {content}
                </h2>
              )}
            </downloadWhitebook.Field>
            <downloadWhitebook.Field name="description">
              {(content) => (
                <p className="mb-8 text-lg text-muted-foreground leading-relaxed">
                  {content}
                </p>
              )}
            </downloadWhitebook.Field>
            <downloadWhitebook.File name="file">
              {(file) => (
                <downloadWhitebook.Field name="cta">
                  {(ctaText) => (
                    <Button size="lg" asChild>
                      <a href={file.url} download={file.filename}>
                        <Download className="mr-2 h-5 w-5" />
                        {ctaText}
                      </a>
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
