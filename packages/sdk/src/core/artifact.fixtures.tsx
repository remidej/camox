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

function ArtifactBlock({
  content,
  Providers,
  queryClient,
}: {
  content: Record<string, unknown>;
  Providers: (props: { children: React.ReactNode }) => React.ReactNode;
  queryClient: QueryClient;
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <Providers>
        <NormalizedDataProvider files={[]} repeatableItems={[]} blocks={[]}>
          <artifactBlock._internal.Component
            mode="site"
            blockData={{ _id: 1, type: "visual", position: "a0", content: content as never }}
          />
        </NormalizedDataProvider>
      </Providers>
    </QueryClientProvider>
  );
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
