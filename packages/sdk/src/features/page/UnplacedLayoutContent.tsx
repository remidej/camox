import type { LookPlaceholderHeight } from "@camox/api-contract/drafts";
import type * as React from "react";

import type { CamoxApp } from "../../core/createApp";
import { buildLayoutContext } from "../../core/layoutContext";
import { usePageBlocks } from "../../lib/normalized-data";
import { useViewLocale } from "../../lib/view-locale-context";
import type { PageRenderInput } from "../runtime/runtime";
import { SharedLayoutContent } from "./SharedLayoutContent";

const EMPTY_PAGE = { blockIds: [] as string[] };

/**
 * How tall the placeholder stands: short enough to leave the footer on the first screen, which
 * shows whether it rises up it, or taller than any screen, as a long page is.
 */
const PLACEHOLDER_HEIGHTS: Record<LookPlaceholderHeight, string> = {
  short: "16rem",
  tall: "300vh",
};

/** A grey that reads on light and dark Themes alike. */
const HATCH = "rgba(128, 128, 128, 0.35)";

/**
 * Where a page's content goes, as the look document's Layout Definition mode shows it: a labelled,
 * hatched area, styled inline, since the site's stylesheet knows nothing of it.
 */
function PageContentPlaceholder({ height }: { height: LookPlaceholderHeight }) {
  const style: React.CSSProperties = {
    minHeight: PLACEHOLDER_HEIGHTS[height],
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    padding: "2rem",
    border: `2px dashed ${HATCH}`,
    backgroundImage: `repeating-linear-gradient(45deg, ${HATCH} 0 2px, transparent 2px 14px)`,
    font: "600 14px/1.4 system-ui, sans-serif",
    color: "rgb(128, 128, 128)",
  };
  return (
    <div data-camox-look-placeholder={height} style={style}>
      <span>Page content</span>
    </div>
  );
}

/**
 * A curated Layout around no page, alone, as the look document's Layout Definition mode shows it
 * (ADR 0032): its blocks, read like a Layout's, around a placeholder for a page's content.
 */
export function UnplacedLayoutContent({
  camoxApp,
  lookLayout,
}: {
  camoxApp: CamoxApp;
  lookLayout: NonNullable<PageRenderInput["lookLayout"]>;
}) {
  const { beforeBlocks, afterBlocks, layoutFiles, layoutItems } = usePageBlocks({
    page: EMPTY_PAGE,
    layout: lookLayout.layout,
  });
  const { locale } = useViewLocale();
  const layout = camoxApp.getLayoutById(lookLayout.layoutId);
  if (!layout) throw new Error(`Unknown layout: ${lookLayout.layoutId}`);
  const context = buildLayoutContext(
    { kind: "curated", title: "" },
    { path: lookLayout.path, locale: locale.tag, projectName: lookLayout.projectName },
  );
  return (
    <SharedLayoutContent
      layout={layout}
      context={context}
      blocks={[...beforeBlocks, ...afterBlocks]}
      files={layoutFiles}
      repeatableItems={layoutItems}
    >
      <PageContentPlaceholder height={lookLayout.placeholder} />
    </SharedLayoutContent>
  );
}
