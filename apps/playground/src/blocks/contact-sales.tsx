import { createBlock } from "camox/createBlock";
import { X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";

const contactSales = createBlock({
  id: "contact-sales",
  title: "Contact sales",
  description:
    "A call to action inviting visitors to talk to the sales team. Its button opens a side sheet with a short contact form. Place it near the end of a page, after the product has been presented.",
  content: (field) => ({
    title: field.string({ default: "Talk to our team", title: "Title" }),
    description: field.string({
      default: "Tell us about your project and we'll get back to you within a day.",
      maxLength: 280,
      title: "Description",
    }),
    cta: field.string({ default: "Contact sales", maxLength: 40, title: "Button label" }),
    sheetTitle: field.string({ default: "Contact sales", title: "Sheet title" }),
  }),
  component: ContactSalesComponent,
  toMarkdown: (c) => [`## ${c.title}`, c.description],
});

function ContactSalesComponent() {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  return (
    <Section scheme="tint">
      <Container className="text-center">
        <contactSales.Field name="title">
          {(props) => <h2 {...props} className="text-heading mb-4" />}
        </contactSales.Field>
        <contactSales.Field name="description">
          {(props) => <p {...props} className="text-lead text-ink-muted mx-auto mb-8 max-w-xl" />}
        </contactSales.Field>
        <Button size="lg" onClick={() => setOpen(true)}>
          <contactSales.Field name="cta">{(props) => <span {...props} />}</contactSales.Field>
        </Button>
      </Container>

      {/* A side sheet as tall as the viewport: `fixed` and `h-screen` (100vh). */}
      {open && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="contact-sales-title"
            className="bg-panel absolute top-0 right-0 flex h-screen w-full max-w-md flex-col shadow-xl"
          >
            <header className="flex items-center justify-between border-b p-6">
              <contactSales.Field name="sheetTitle">
                {(props) => (
                  <h2 {...props} id="contact-sales-title" className="text-lg font-semibold" />
                )}
              </contactSales.Field>
              <Button
                variant="plain"
                className="size-10 px-0"
                aria-label="Close"
                onClick={() => setOpen(false)}
              >
                <X />
              </Button>
            </header>
            {sent ? (
              <p className="text-ink-muted p-6">Thanks! We'll be in touch.</p>
            ) : (
              <form
                className="flex flex-1 flex-col gap-4 overflow-y-auto p-6"
                onSubmit={(event) => {
                  event.preventDefault();
                  setSent(true);
                }}
              >
                <label className="flex flex-col gap-1 text-sm font-medium">
                  Name
                  <input required className="rounded-control border px-3 py-2 font-normal" />
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium">
                  Work email
                  <input
                    required
                    type="email"
                    className="rounded-control border px-3 py-2 font-normal"
                  />
                </label>
                <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
                  Message
                  <textarea className="rounded-control min-h-32 flex-1 border px-3 py-2 font-normal" />
                </label>
                {/* Pinned to the bottom of the viewport-tall sheet. */}
                <Button type="submit" className="mt-auto">
                  Send
                </Button>
              </form>
            )}
          </aside>
        </div>
      )}
    </Section>
  );
}

export { contactSales as block };
