import { Label } from "@camox/ui/label";
import * as React from "react";

import type { OverlayMessage } from "../overlayMessages";

type DrillRowHover =
  | { variant: "field"; fieldId: string }
  | { variant: "repeater"; blockId: number; fieldName: string };

interface DrillRowProps {
  label: string;
  preview: string;
  Icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  hover: DrillRowHover;
  postToIframe: (message: OverlayMessage) => void;
}

/** Label and drill-down button with hover that cannot outlive its sidebar row. */
export const DrillRow = ({ label, preview, Icon, onClick, hover, postToIframe }: DrillRowProps) => {
  const [isHovered, setIsHovered] = React.useState(false);
  const fieldId = hover.variant === "field" ? hover.fieldId : undefined;
  const blockId = hover.variant === "repeater" ? String(hover.blockId) : undefined;
  const fieldName = hover.variant === "repeater" ? hover.fieldName : undefined;

  // Clicking into the list unmounts this row without firing mouseleave. Pair the
  // messages through effect cleanup so group hover cannot mask individual items.
  React.useEffect(() => {
    if (!isHovered) return;
    if (fieldId !== undefined) {
      postToIframe({ type: "CAMOX_HOVER_FIELD", fieldId });
      return () => postToIframe({ type: "CAMOX_HOVER_FIELD_END", fieldId });
    }
    if (blockId === undefined || fieldName === undefined) return;
    postToIframe({ type: "CAMOX_HOVER_REPEATER", blockId, fieldName });
    return () => postToIframe({ type: "CAMOX_HOVER_REPEATER_END", blockId, fieldName });
  }, [isHovered, fieldId, blockId, fieldName, postToIframe]);

  return (
    <div
      className="space-y-2"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <Label>{label}</Label>
      <button
        type="button"
        className="hover:bg-accent/75 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors"
        onClick={() => {
          setIsHovered(false);
          onClick();
        }}
      >
        <Icon className="text-muted-foreground h-4 w-4 shrink-0" />
        <span className="truncate">{preview}</span>
      </button>
    </div>
  );
};
