import { createLayout } from "camox/createLayout";

export const Layout = createLayout("test")({
  kind: "curated",
  title: "test",
  description: "",
  blocks: { before: [], after: [] },
  buildMetaTitle: ({ pageMetaTitle }) => pageMetaTitle,
  component: ({ children }) => (
    <main>
      <Layout.BeforeBlocks />
      {children}
      <Layout.AfterBlocks />
    </main>
  ),
});
