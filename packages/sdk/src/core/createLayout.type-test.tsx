import { createLayout } from "./createLayout";

const Definition = createLayout("pokemon.$name")({
  kind: "derived",
  title: "Pokemon",
  description: "",
  blocks: { before: [], after: [] },
  buildMetaTitle: ({ pageMetaTitle }) => pageMetaTitle,
  loader: async ({ params }) => {
    const name: string = params.name;
    // @ts-expect-error Only parameters named by the file identity exist.
    void params.slug;
    return { name, count: 1 };
  },
  component: () => null,
});

function DataTypeCheck() {
  const data = Definition.useData();
  const count: number = data.count;
  // @ts-expect-error Awaited loader data is not any.
  const invalid: string = data.count;
  return (
    <span>
      {count}
      {invalid}
    </span>
  );
}
void DataTypeCheck;
