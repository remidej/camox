import type { PageRecordId } from "../../preview/pageRecord";
import { LayoutPageOverview } from "./LayoutPageOverview";

/**
 * A derived page: its layout's blocks, shared by every page of the layout, around content
 * its code generates. A record page's content is its record, edited from the preview.
 */
export function DerivedPageInspector({
  layoutId,
  pageRecord,
  runtimeBasePath,
}: {
  layoutId: string;
  runtimeBasePath: string;
  /** The record of a record page. */
  pageRecord?: PageRecordId;
}) {
  return (
    <LayoutPageOverview
      layoutId={layoutId}
      target={{ runtimeBasePath, derivedLayoutId: layoutId }}
      notice={{
        title: "Shared layout blocks",
        description: pageRecord
          ? "Changes to these blocks apply to every page using this layout. Select this page’s content in the preview to edit its record, shared everywhere it appears."
          : "Changes apply to every page using this layout. The generated page content is managed outside the studio.",
      }}
    />
  );
}
