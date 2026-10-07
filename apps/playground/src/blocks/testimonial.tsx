import { createBlock } from "camox/createBlock";

import { collection as customers } from "../collections/customers";

const testimonial = createBlock({
  id: "testimonial",
  title: "Testimonial",
  description:
    "Display customer testimonials or user reviews. Ideal for building trust and social proof. Place after product features or before call-to-action sections. The quote should be a genuine customer statement, and include attribution with the author name, their title, and company. Best used when you have compelling customer feedback to share.",
  content: (field) => ({
    quote: field.string({
      default:
        "This platform has transformed how we build and manage our website. The developer experience is exceptional.",
      title: "Quote",
    }),
    author: field.string({ default: "Sarah Chen", title: "Author" }),
    title: field.string({ default: "Senior Developer", title: "Title" }),
    company: field.reference(customers, { title: "Company" }),
  }),
  component: TestimonialComponent,
  toMarkdown: (c) => [`> ${c.quote}`, `— ${c.author}, ${c.title}, ${c.company.company}`],
});

function TestimonialComponent() {
  return (
    <section className="bg-background py-24">
      <div className="container mx-auto px-4">
        <div className="mx-auto max-w-4xl text-center">
          <testimonial.Field name="quote">
            {(props) => (
              <blockquote
                {...props}
                className="text-foreground mb-8 text-2xl leading-relaxed font-medium sm:text-3xl"
              >
                "{props.children}"
              </blockquote>
            )}
          </testimonial.Field>
          <div className="flex flex-col items-center">
            <testimonial.Field name="author">
              {(props) => (
                <cite {...props} className="text-foreground text-lg font-semibold not-italic" />
              )}
            </testimonial.Field>
            <div className="text-muted-foreground flex flex-col sm:flex-row sm:items-center sm:gap-2">
              <testimonial.Field name="title">{(props) => <span {...props} />}</testimonial.Field>
              <span className="">&nbsp;—&nbsp;</span>
              <testimonial.Reference name="company">
                {(customer) => (
                  <span className="inline-flex items-center gap-2">
                    <customer.Image name="logo">
                      {(props) => <img {...props} className="h-8 max-w-24 object-contain" />}
                    </customer.Image>
                    <customer.Field name="company">{(props) => <span {...props} />}</customer.Field>
                  </span>
                )}
              </testimonial.Reference>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export { testimonial as block };
