import { createBlock } from "camox/createBlock";

import { collection as customers } from "../collections/customers";

const customerHighlights = createBlock({
  id: "customer-highlights",
  title: "Customer highlights",
  description:
    "Spotlight a few customers, each with a short note on what they achieved. Place it after product features or near a call to action. Each highlight links a shared Customers item, so its logo and company name stay consistent everywhere, while the note and emphasis belong to this block only.",
  content: (field) => ({
    title: field.string({ default: "Customers shipping with Camox", title: "Title" }),
    highlights: field.repeater({
      content: (field) => ({
        customer: field.reference(customers, { title: "Customer", required: true }),
        note: field.string({ default: "Launched their new site in a week.", title: "Note" }),
      }),
      settings: (setting) => ({
        emphasized: setting.boolean({ default: false, title: "Emphasized" }),
      }),
      minItems: 1,
      maxItems: 6,
      title: "Highlights",
      toMarkdown: (c) => [`${c.customer.company}: ${c.note}`],
    }),
  }),
  component: CustomerHighlightsComponent,
  toMarkdown: (c) => [`## ${c.title}`, c.highlights],
});

function CustomerHighlightsComponent() {
  return (
    <section className="bg-background py-16">
      <div className="container mx-auto px-4">
        <customerHighlights.Field name="title">
          {(props) => (
            <h2 {...props} className="text-foreground mb-10 text-center text-3xl font-semibold" />
          )}
        </customerHighlights.Field>
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <customerHighlights.Repeater name="highlights">
            {(highlight) => (
              <li
                className={
                  highlight.useSetting("emphasized")
                    ? "border-primary rounded-lg border-2 p-6"
                    : "border-border rounded-lg border p-6"
                }
              >
                <highlight.Reference name="customer">
                  {(customer) => (
                    <div className="mb-4 flex items-center gap-3">
                      <customer.Image name="logo">
                        {(props) => <img {...props} className="h-8 max-w-24 object-contain" />}
                      </customer.Image>
                      <customer.Field name="company">
                        {(props) => <span {...props} className="text-foreground font-semibold" />}
                      </customer.Field>
                    </div>
                  )}
                </highlight.Reference>
                <highlight.Field name="note">
                  {(props) => <p {...props} className="text-muted-foreground" />}
                </highlight.Field>
              </li>
            )}
          </customerHighlights.Repeater>
        </ul>
      </div>
    </section>
  );
}

export { customerHighlights as block };
