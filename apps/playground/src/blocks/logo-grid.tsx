import { Type, createBlock } from "camox/createBlock";

import { collection as customers } from "../collections/customers";

const logoGrid = createBlock({
  id: "logo-grid",
  title: "Logo grid",
  description:
    "Display the logos of customers or partners in a grid, as social proof. Place it near a hero, testimonials or a call to action. The heading introduces who the logos belong to, and each logo comes from a shared Customers item so it stays consistent everywhere it appears.",
  content: {
    title: Type.String({ default: "Trusted by teams everywhere", title: "Title" }),
    customers: Type.ReferenceList(customers, { title: "Customers", maxItems: 12 }),
  },
  component: LogoGridComponent,
  toMarkdown: (c) => [`## ${c.title}`],
});

function LogoGridComponent() {
  return (
    <section className="bg-background py-16">
      <div className="container mx-auto px-4">
        <logoGrid.Field name="title">
          {(props) => (
            <h2
              {...props}
              className="text-muted-foreground mb-10 text-center text-sm font-semibold tracking-wide uppercase"
            />
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
                  {(props) => <span {...props} className="text-muted-foreground text-sm" />}
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
