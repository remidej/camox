import { LayoutPageOverview } from "./LayoutPageOverview";

/** A singleton page: its layout's blocks are all its blocks, edited here, at a fixed URL. */
export function SingletonPageInspector({
  layoutId,
  runtimeBasePath,
}: {
  layoutId: string;
  runtimeBasePath: string;
}) {
  return (
    <LayoutPageOverview
      layoutId={layoutId}
      target={{ runtimeBasePath }}
      notice={{
        title: "Fixed page structure",
        description:
          "Edit this page’s blocks here. Its URL and structure are defined in code. Synced blocks share content with their other placements.",
      }}
    />
  );
}
