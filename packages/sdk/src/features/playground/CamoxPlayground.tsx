import * as React from "react";
import type { Block } from "@/core/createBlock";
import { PreviewFrame } from "../preview/components/PreviewPanel";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { useCamoxApp } from "../provider/components/CamoxAppContext";
import type { Id } from "camox/_generated/dataModel";
import { useFrame } from "@/components/ui/frame";

// Needs to be a separate component from PlaygroundBlock to use the Frame context
const HeightWatcher = ({
  onHeightChange,
}: {
  onHeightChange: (height: number) => void;
}) => {
  const { window } = useFrame();

  React.useLayoutEffect(() => {
    if (!window) return;

    const updateHeight = () => {
      onHeightChange(window.document.documentElement.scrollHeight);
    };

    // Initial height measurement
    updateHeight();

    // Watch for DOM changes that might affect height
    const mutationObserver = new MutationObserver(updateHeight);
    mutationObserver.observe(window.document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });

    // Watch for resize changes
    const resizeObserver = new ResizeObserver(updateHeight);
    resizeObserver.observe(window.document.documentElement);

    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, [window, onHeightChange]);

  return null;
};

interface PlaygroundBlockProps {
  block: Block;
  content: any;
}

const PlaygroundBlock = ({ block, content }: PlaygroundBlockProps) => {
  const [height, setHeight] = React.useState<number | null>(null);

  return (
    <Panel key={block.id}>
      <PanelHeader>
        <h2 className="text-sm font-semibold">
          {block.title}{" "}
          <span className="text-muted-foreground">
            (<span className="font-mono">{block.id}</span>)
          </span>
        </h2>
      </PanelHeader>
      <PreviewFrame style={{ height: `${height}px` }}>
        <HeightWatcher onHeightChange={setHeight} />
        <block.Component
          blockData={{
            _id: `__preview__${block.id}` as Id<"blocks">,
            type: block.id,
            content,
            settings: block.getInitialSettings(),
            position: "",
          }}
          mode="playground"
        />
      </PreviewFrame>
    </Panel>
  );
};

export const CamoxPlayground = () => {
  const camoxApp = useCamoxApp();
  const allBlocks = camoxApp.getBlocks();

  return (
    <div className="checkered flex-1 p-16 overflow-auto">
      <div className="flex flex-col gap-16">
        {allBlocks.map((block: Block) => {
          const initialContent = block.getInitialContent();
          const normalizedContent = { ...initialContent };

          // Transform array fields from content-only to full item objects
          for (const key in normalizedContent) {
            const value = normalizedContent[key];
            if (Array.isArray(value) && value.length > 0) {
              const firstItem = value[0];
              if (
                firstItem &&
                typeof firstItem === "object" &&
                !firstItem.content &&
                !firstItem._id
              ) {
                normalizedContent[key] = value.map((item: any) => ({
                  content: item,
                  _id: undefined,
                }));
              }
            }
          }

          return (
            <PlaygroundBlock
              key={block.id}
              block={block}
              content={normalizedContent}
            />
          );
        })}
      </div>
    </div>
  );
};
