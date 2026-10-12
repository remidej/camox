import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Window } from "happy-dom";
import type * as React from "react";
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

/**
 * Renders `artifactBlock` with `content` inside `Providers` and returns the frames it rendered,
 * in document order.
 */
export function renderArtifactFrames(
  content: Record<string, unknown>,
  Providers: (props: { children: React.ReactNode }) => React.ReactNode,
) {
  const html = renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <Providers>
        <NormalizedDataProvider files={[]} repeatableItems={[]} blocks={[]}>
          <artifactBlock._internal.Component
            mode="site"
            blockData={{ _id: 1, type: "visual", position: "a0", content: content as never }}
          />
        </NormalizedDataProvider>
      </Providers>
    </QueryClientProvider>,
  );
  const window = new Window();
  window.document.body.innerHTML = html;
  return [...window.document.querySelectorAll("iframe")];
}
