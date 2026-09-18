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

const singletonOptions = {
  title: "Pokédex",
  description: "",
  blocks: { before: [], after: [] },
  buildMetaTitle: ({ pageMetaTitle }: { pageMetaTitle: string }) => pageMetaTitle,
  component: () => null,
};
const Singleton = createLayout("pokedex")({
  ...singletonOptions,
  kind: "singleton",
  loader: async () => ({ count: 12 }),
});
const StaticSingleton = createLayout("about")({ ...singletonOptions, kind: "singleton" });
function SingletonTypeCheck() {
  const count: number = Singleton.useData().count;
  // @ts-expect-error Singleton loader result is inferred, not any.
  const invalid: string = Singleton.useData().count;
  const empty: undefined = StaticSingleton.useData();
  return (
    <span>
      {count}
      {invalid}
      {empty}
    </span>
  );
}
void SingletonTypeCheck;
// @ts-expect-error Singletons cannot seed curated page content.
createLayout("invalid")({
  ...singletonOptions,
  kind: "singleton",
  blocks: { before: [], after: [], initial: [] },
});
