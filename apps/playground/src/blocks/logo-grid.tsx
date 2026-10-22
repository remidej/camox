import { createBlock } from "camox/createBlock";

import { collection as customers } from "../collections/customers";

const logoGrid = createBlock({
  id: "logo-grid",
  title: "Logo grid",
  description:
    "Display the logos of customers or partners in a grid, as social proof. Place it near a hero, testimonials or a call to action. The heading introduces who the logos belong to, and each logo comes from a shared Customers item so it stays consistent everywhere it appears.",
  content: (field) => ({
    title: field.string({ default: "Trusted by teams everywhere", title: "Title" }),
    customers: field.referenceList(customers, {
      title: "Customers",
      maxItems: 12,
      toMarkdown: (c) => [`${c.logo} ${c.company}`],
    }),
  }),
  component: LogoGridComponent,
  toMarkdown: (c) => [`## ${c.title}`, c.customers],
});

function LogoGridComponent() {
  return (
    <section className="bg-canvas py-16">
      <div className="max-w-page px-gutter mx-auto">
        <logoGrid.Field name="title">
          {(props) => (
            <h2 {...props} className="text-eyebrow text-ink-muted mb-10 text-center uppercase" />
          )}
        </logoGrid.Field>
        <ul className="grid grid-cols-2 items-center gap-8 sm:grid-cols-3 lg:grid-cols-6">
          <logoGrid.ReferenceList name="customers">
            {(customer) => (
              <li className="flex flex-col items-center gap-2">
                <customer.Image name="logo">
                  {(props) => (
                    <img {...props} alt={customer.label} className="h-10 max-w-32 object-contain" />
                  )}
                </customer.Image>
                <customer.Field name="company">
                  {(props) => <span {...props} className="text-ink-muted text-sm" />}
                </customer.Field>
              </li>
            )}
          </logoGrid.ReferenceList>
        </ul>
      </div>
    </section>
  );
}

export { logoGrid as block };
