import { Type, createBlock } from "camox/createBlock";

const testimonial = createBlock({
  id: "testimonial",
  title: "Testimonial",
  description:
    "Display customer testimonials or user reviews. Ideal for building trust and social proof. Place after product features or before call-to-action sections. The quote should be a genuine customer statement, and include attribution with the author name, their title, and company. Best used when you have compelling customer feedback to share.",
  content: {
    quote: Type.String({
      default:
        "This platform has transformed how we build and manage our website. The developer experience is exceptional.",
      title: "Quote",
    }),
    author: Type.String({ default: "Sarah Chen", title: "Author" }),
    title: Type.String({ default: "Senior Developer", title: "Title" }),
    company: Type.String({ default: "TechCorp", title: "Company" }),
  },
  component: TestimonialComponent,
});

function TestimonialComponent() {
  return (
    <section className="py-24 bg-background">
      <div className="container mx-auto px-4">
        <div className="max-w-4xl mx-auto text-center">
          <testimonial.Field name="quote">
            {(content) => (
              <blockquote className="text-2xl font-medium leading-relaxed text-foreground mb-8 sm:text-3xl">
                "{content}"
              </blockquote>
            )}
          </testimonial.Field>
          <div className="flex flex-col items-center">
            <testimonial.Field name="author">
              {(content) => (
                <cite className="not-italic font-semibold text-lg text-foreground">
                  {content}
                </cite>
              )}
            </testimonial.Field>
            <div className="flex flex-col sm:flex-row sm:items-center sm:gap-2 text-muted-foreground">
              <testimonial.Field name="title">
                {(content) => <span>{content}</span>}
              </testimonial.Field>
              <span className="hidden sm:inline">•</span>
              <testimonial.Field name="company">
                {(content) => <span>{content}</span>}
              </testimonial.Field>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export { testimonial as block };
