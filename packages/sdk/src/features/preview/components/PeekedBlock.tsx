import * as React from "react";
import { useSelector } from "@xstate/store/react";
import type { Id } from "camox/_generated/dataModel";
import { previewStore } from "../previewStore";

export const PeekedBlock = () => {
  const peekedBlock = useSelector(
    previewStore,
    (state) => state.context.peekedBlock,
  );

  const peekedBlockRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (peekedBlock && peekedBlockRef.current) {
      peekedBlockRef.current.scrollIntoView({
        behavior: "instant",
        block: "start",
      });
    }
  }, [peekedBlock]);

  // Normalize content to handle repeatableObject arrays
  // In preview mode, getInitialContent() returns arrays as [{...}, {...}]
  // But the Component expects arrays to be in full item format [{content: {...}, _id: ...}]
  // when passed to Context, and content-only format when passed to options.component
  const normalizedContent = React.useMemo(() => {
    if (!peekedBlock) return null;

    const initialContent = peekedBlock.getInitialContent();
    const result = { ...initialContent } as any;

    // Transform array fields from content-only to full item objects for Context
    // The Component will handle transforming them back to content-only for options.component
    for (const key in result) {
      const value = result[key];
      if (Array.isArray(value) && value.length > 0) {
        // Check if this looks like a repeatableObject array (array of plain objects)
        const firstItem = value[0];
        if (
          firstItem &&
          typeof firstItem === "object" &&
          !firstItem.content &&
          !firstItem._id
        ) {
          // This is a content-only array - wrap each item in the full format
          result[key] = value.map((item: any) => ({
            content: item,
            _id: undefined, // No _id in preview mode
          }));
        }
      }
    }

    return result;
  }, [peekedBlock]);

  if (!peekedBlock || !normalizedContent) {
    return null;
  }

  return (
    <div
      ref={peekedBlockRef}
      style={{
        scrollMargin: "5rem",
        background: "var(--background)",
      }}
    >
      <div style={{ opacity: 0.5 }}>
        <peekedBlock.Component
          blockData={{
            _id: "__preview__" as Id<"blocks">,
            type: peekedBlock.id,
            content: normalizedContent,
            settings: peekedBlock.getInitialSettings(),
            position: "",
          }}
          mode="peek"
        />
      </div>
    </div>
  );
};
