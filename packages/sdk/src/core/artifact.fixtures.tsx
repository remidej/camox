import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import type * as React from "react";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { NormalizedDataProvider } from "../lib/normalized-data";
import { createBlock } from "./createBlock";

/** A block with a top-level artifact and an artifact in each repeatable item. */
export const artifactBlock = createBlock({
  id: "visual",
  title: "Visual",
  description: "",
  content: (field) => ({
    visual: field.artifact({ size: "fill" }),
    slides: field.repeater({
      content: (field) => ({ scene: field.artifact({ size: "content" }) }),
      minItems: 1,
      maxItems: 3,
      toMarkdown: () => [],
    }),
  }),
  toMarkdown: () => [],
  component: () => (
    <>
      <artifactBlock.Artifact name="visual">
        {(props) => <iframe {...props} />}
      </artifactBlock.Artifact>
      <artifactBlock.Repeater name="slides">
        {(item) => <item.Artifact name="scene">{(props) => <iframe {...props} />}</item.Artifact>}
      </artifactBlock.Repeater>
    </>
  ),
});

/** A block whose artifacts share sibling fields and settings as Artifact Data. */
export const chartBlock = createBlock({
  id: "chart",
  title: "Chart",
  description: "",
  content: (field) => ({
    headline: field.string({ default: "Growth", title: "Headline" }),
    cta: field.link({
      default: { text: "Read more", href: "https://example.com/report", newTab: true },
    }),
    photo: field.image({ title: "Photo" }),
    chart: field.artifact({ size: "fill", data: ["headline", "cta", "photo", "accent"] }),
    bars: field.repeater({
      content: (field) => ({
        label: field.string({ default: "Bar" }),
        bar: field.artifact({ size: "content", data: ["label", "highlighted"] }),
      }),
      settings: (setting) => ({ highlighted: setting.boolean({ default: false }) }),
      minItems: 1,
      maxItems: 3,
      toMarkdown: (c) => [c.label],
    }),
  }),
  settings: (setting) => ({
    accent: setting.enum({ default: "blue", options: { blue: "Blue", red: "Red" } }),
  }),
  toMarkdown: (c) => [c.headline],
  component: () => (
    <>
      <chartBlock.Artifact name="chart">{(props) => <iframe {...props} />}</chartBlock.Artifact>
      <chartBlock.Repeater name="bars">
        {(item) => <item.Artifact name="bar">{(props) => <iframe {...props} />}</item.Artifact>}
      </chartBlock.Repeater>
    </>
  ),
});

const chartSource = `<!doctype html><title>Chart</title><script>document.title = camox.data.headline</script>`;

/** A chart block's content and settings, as stored, with the file its photo points to. */
export const chartData = {
  content: {
    headline: "Revenue </script><p>up",
    cta: { type: "external", text: "Report", href: "https://example.com/q3", newTab: false },
    photo: { _fileId: 7 },
    chart: chartSource,
    bars: [
      { id: 3, content: { label: "Q1", bar: chartSource }, settings: { highlighted: true } },
      { id: 4, content: { label: "Q2", bar: chartSource }, settings: null },
    ],
  },
  settings: { accent: "red" },
  files: [
    {
      id: 7,
      url: "https://cdn.example.test/photo.png",
      alt: "Team photo",
      filename: "photo.png",
      mimeType: "image/png",
      size: 1,
    } as never,
  ],
};

/** The Artifact Data `chartData`'s chart artifact sees: links as hrefs and assets as URLs. */
export const chartDataSeen = {
  headline: "Revenue </script><p>up",
  cta: { text: "Report", href: "https://example.com/q3", newTab: false },
  photo: { url: "https://cdn.example.test/photo.png", alt: "Team photo" },
  accent: "red",
};

/** What a block renders from: its content and settings, and the files its content points to. */
export type ArtifactBlockData = {
  content: Record<string, unknown>;
  settings?: Record<string, unknown>;
  files?: React.ComponentProps<typeof NormalizedDataProvider>["files"];
};

function ArtifactBlock({
  block = artifactBlock,
  content,
  settings,
  files = [],
  Providers,
  queryClient,
}: ArtifactBlockData & {
  block?: typeof artifactBlock | typeof chartBlock;
  Providers: (props: { children: React.ReactNode }) => React.ReactNode;
  queryClient: QueryClient;
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <Providers>
        <NormalizedDataProvider files={files} repeatableItems={[]} blocks={[]}>
          <block._internal.Component
            mode="site"
            blockData={{
              _id: 1,
              type: block._internal.id,
              position: "a0",
              content: content as never,
              settings,
            }}
          />
        </NormalizedDataProvider>
      </Providers>
    </QueryClientProvider>
  );
}

/**
 * Renders `chartBlock` with `data` inside `Providers` and returns the frames it rendered, in
 * document order.
 */
export function renderChartFrames(
  data: ArtifactBlockData,
  Providers: (props: { children: React.ReactNode }) => React.ReactNode,
) {
  const html = renderToStaticMarkup(
    <ArtifactBlock
      block={chartBlock}
      {...data}
      Providers={Providers}
      queryClient={new QueryClient()}
    />,
  );
  const window = new Window();
  window.document.body.innerHTML = html;
  return [...window.document.querySelectorAll("iframe")];
}

/**
 * Mounts `chartBlock` with `data` inside `Providers` into `container`, so its frames connect to
 * their artifacts. `update` re-renders the block with new data, as an editor's change would.
 */
export async function mountChartFrames(
  data: ArtifactBlockData,
  Providers: (props: { children: React.ReactNode }) => React.ReactNode,
  container: HTMLElement,
) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(container);
  const queryClient = new QueryClient();
  const render = (next: ArtifactBlockData) =>
    act(async () => {
      root.render(
        <ArtifactBlock
          block={chartBlock}
          {...next}
          Providers={Providers}
          queryClient={queryClient}
        />,
      );
    });
  await render(data);
  return {
    frames: () => [...container.querySelectorAll("iframe")],
    update: render,
    unmount: () => act(async () => root.unmount()),
  };
}

/**
 * Mounts `artifactBlock` with `content` inside `Providers` into `container`, so its frames
 * connect to their artifacts. Returns the frames it rendered, in document order.
 */
export async function mountArtifactFrames(
  content: Record<string, unknown>,
  Providers: (props: { children: React.ReactNode }) => React.ReactNode,
  container: HTMLElement,
) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <ArtifactBlock content={content} Providers={Providers} queryClient={new QueryClient()} />,
    );
  });
  return {
    frames: [...container.querySelectorAll("iframe")],
    unmount: () => act(async () => root.unmount()),
  };
}

/**
 * Renders `artifactBlock` with `content` inside `Providers` and returns the frames it rendered,
 * in document order.
 */
export function renderArtifactFrames(
  content: Record<string, unknown>,
  Providers: (props: { children: React.ReactNode }) => React.ReactNode,
) {
  const html = renderToStaticMarkup(
    <ArtifactBlock content={content} Providers={Providers} queryClient={new QueryClient()} />,
  );
  const window = new Window();
  window.document.body.innerHTML = html;
  return [...window.document.querySelectorAll("iframe")];
}
