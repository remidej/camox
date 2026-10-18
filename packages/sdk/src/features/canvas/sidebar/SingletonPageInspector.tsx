import { LayoutPageOverview } from "./LayoutPageOverview";

/** A singleton page: its layout's blocks are all its blocks, edited here, at a fixed URL. */
export function SingletonPageInspector({ layoutId }: { layoutId: string }) {
  return (
    <LayoutPageOverview
      layoutId={layoutId}
      notice={{
        title: "Fixed page structure",
        description:
          "Edit this page’s blocks here. Its URL and structure are defined in code. Synced blocks share content with their other placements.",
      }}
    />
  );
}
