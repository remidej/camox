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
    return { kind: "data", data: { name, count: 1 } };
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
  loader: async () => ({ kind: "data", data: { count: 12 } }),
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

const syncLayout = createLayout("sync")({
  ...singletonOptions,
  kind: "singleton",
  loader: () => ({ kind: "data", data: { nested: [1, 2], nullable: null } }),
});
const legacyLayout = createLayout({
  ...singletonOptions,
  id: "legacy",
  kind: "singleton",
  loader: async () => ({ kind: "data", data: "legacy data" }),
});
const curatedLayout = createLayout("curated")({ ...singletonOptions, kind: "curated" });
const loadCount = async () => ({ kind: "data" as const, data: { count: 12 } });
const wrappedLoader = async () => await loadCount();
const wrappedLayout = createLayout("wrapped")({
  ...singletonOptions,
  kind: "singleton",
  loader: wrappedLoader,
});

function MoreDataTypeChecks() {
  const numbers: number[] = syncLayout.useData().nested;
  const nullable: null = syncLayout.useData().nullable;
  const legacy: string = legacyLayout.useData();
  const empty: undefined = curatedLayout.useData();
  const wrapped: number = wrappedLayout.useData().count;
  // @ts-expect-error useData returns only the payload, not the envelope.
  void Definition.useData().kind;
  // @ts-expect-error Ordinary data does not expose a collection item scope.
  void Definition.Item;
  return [numbers, nullable, legacy, empty, wrapped];
}
void MoreDataTypeChecks;

createLayout("old-result")({
  ...singletonOptions,
  kind: "singleton",
  // @ts-expect-error Bare loader data is no longer accepted.
  loader: async () => ({ count: 12 }),
});
createLayout("missing-data")({
  ...singletonOptions,
  kind: "singleton",
  // @ts-expect-error Every successful loader result must contain data.
  loader: () => ({ kind: "data" }),
});
createLayout("future-result")({
  ...singletonOptions,
  kind: "singleton",
  // @ts-expect-error Collection-item envelopes are not implemented in this slice.
  loader: () => ({ kind: "collection-item", collectionId: "articles", data: {} }),
});
createLayout("undefined-result")({
  ...singletonOptions,
  kind: "singleton",
  // @ts-expect-error Omit the loader rather than returning no envelope.
  loader: () => undefined,
});
