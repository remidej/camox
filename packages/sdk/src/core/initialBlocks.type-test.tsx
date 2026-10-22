import { createBlock } from "./createBlock";
import { createLayout } from "./createLayout";

const blockOptions = {
  title: "Block",
  description: "",
  content: () => ({}),
  toReact: () => null,
  toMarkdown: () => [],
  toTitle: () => "Block",
};
const pageBlock = createBlock({ ...blockOptions, id: "hero" });
const layoutOnlyBlock = createBlock({ ...blockOptions, id: "navbar", layoutOnly: true });

const layoutOptions = {
  title: "Default",
  description: "",
  toReact: ({ children }: { children: React.ReactNode }) => children,
  toTitle: ({ page }: { page: { title: string } }) => page.title,
  toDescription: ({ page }: { page: { description: string | undefined } }) => page.description,
};

// Initial blocks are module imports, so layouts don't load them on every page.
createLayout("default")({
  ...layoutOptions,
  kind: "curated",
  blocks: { before: [], after: [], initial: [async () => ({ block: pageBlock })] },
});

createLayout("default")({
  ...layoutOptions,
  kind: "curated",
  blocks: {
    before: [],
    after: [],
    // @ts-expect-error Initial blocks are imports of block modules, not blocks.
    initial: [pageBlock],
  },
});

createLayout("default")({
  ...layoutOptions,
  kind: "curated",
  blocks: {
    before: [],
    after: [],
    // @ts-expect-error Initial blocks are page content, never layout-only.
    initial: [async () => ({ block: layoutOnlyBlock })],
  },
});
