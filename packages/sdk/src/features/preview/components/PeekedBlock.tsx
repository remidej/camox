import * as React from "react";
import { useSelector } from "@xstate/store/react";
import type { Id } from "camox/_generated/dataModel";
import { previewStore } from "../previewStore";
import type { Block } from "../../../core/createBlock";

interface PeekedBlockProps {
  onExitComplete?: () => void;
}

export const PeekedBlock = ({ onExitComplete }: PeekedBlockProps) => {
  const peekedBlock = useSelector(
    previewStore,
    (state) => state.context.peekedBlock,
  );
  const skipExitAnimation = useSelector(
    previewStore,
    (state) => state.context.skipPeekedBlockExitAnimation,
  );

  const peekedBlockRef = React.useRef<HTMLDivElement>(null);
  const [displayedBlock, setDisplayedBlock] = React.useState<Block | null>(
    null,
  );
  const [isExpanded, setIsExpanded] = React.useState(false);

  // When peekedBlock changes to non-null → latch it; when null → start collapse (or skip)
  React.useEffect(() => {
    if (peekedBlock) {
      setDisplayedBlock(peekedBlock);
      return;
    }

    if (skipExitAnimation) {
      setIsExpanded(false);
      setDisplayedBlock(null);
      onExitComplete?.();
      previewStore.send({ type: "clearSkipPeekedBlockExitAnimation" });
      return;
    }

    setIsExpanded(false);
  }, [peekedBlock, skipExitAnimation, onExitComplete]);

  // When displayedBlock becomes non-null → expand on next frame
  React.useEffect(() => {
    if (!displayedBlock) return;
    const id = requestAnimationFrame(() => setIsExpanded(true));
    return () => cancelAnimationFrame(id);
  }, [displayedBlock]);

  // Scroll into view when displayedBlock changes
  React.useEffect(() => {
    if (displayedBlock && peekedBlockRef.current) {
      peekedBlockRef.current.scrollIntoView({
        behavior: "instant",
        block: "start",
      });
    }
  }, [displayedBlock]);

  const handleTransitionEnd = React.useCallback(
    (e: React.TransitionEvent<HTMLDivElement>) => {
      if (
        e.propertyName !== "grid-template-rows" ||
        e.target !== e.currentTarget
      ) {
        return;
      }
      // Only clear on collapse (when not expanded)
      if (!isExpanded) {
        setDisplayedBlock(null);
        onExitComplete?.();
      }
    },
    [isExpanded, onExitComplete],
  );

  // Normalize content to handle repeatableObject arrays
  const normalizedContent = React.useMemo(() => {
    if (!displayedBlock) return null;

    const initialContent = displayedBlock.getInitialContent();
    const result = { ...initialContent } as any;

    for (const key in result) {
      const value = result[key];
      if (Array.isArray(value) && value.length > 0) {
        const firstItem = value[0];
        if (
          firstItem &&
          typeof firstItem === "object" &&
          !firstItem.content &&
          !firstItem._id
        ) {
          result[key] = value.map((item: any) => ({
            content: item,
            _id: undefined,
          }));
        }
      }
    }

    return result;
  }, [displayedBlock]);

  if (!displayedBlock || !normalizedContent) {
    return null;
  }

  return (
    <div
      ref={peekedBlockRef}
      style={{
        scrollMargin: "5rem",
        display: "grid",
        gridTemplateRows: isExpanded ? "1fr" : "0fr",
        transition: "grid-template-rows 300ms ease-out",
        background: "var(--background)",
      }}
      onTransitionEnd={handleTransitionEnd}
    >
      <div style={{ overflow: "hidden" }}>
        {/*<div style={{ opacity: 0.5, background: "var(--background)" }}>*/}
        <displayedBlock.Component
          blockData={{
            _id: "__preview__" as Id<"blocks">,
            type: displayedBlock.id,
            content: normalizedContent,
            settings: displayedBlock.getInitialSettings(),
            position: "",
          }}
          mode="peek"
        />
        {/*</div>*/}
      </div>
    </div>
  );
};
