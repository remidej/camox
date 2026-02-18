import * as React from "react";
import { OVERLAY_COLORS } from "../../features/preview/overlayConstants";

interface AddBlockControlBarProps {
  position: "top" | "bottom";
  hidden: boolean;
  onClick: () => void;
  onMouseLeave: () => void;
}

export const AddBlockControlBar = ({
  position,
  hidden,
  onClick,
  onMouseLeave,
}: AddBlockControlBarProps) => {
  const [isExpanded, setIsExpanded] = React.useState(false);

  return (
    <div
      style={{
        position: "absolute",
        top: position === "top" ? 0 : undefined,
        bottom: position === "bottom" ? 0 : undefined,
        left: 0,
        right: 0,
        height: "36px",
        transform: position === "top" ? "translateY(-50%)" : "translateY(50%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 11,
        opacity: hidden ? 0 : 1,
        pointerEvents: hidden ? "none" : "auto",
        transition: "opacity 150ms ease",
      }}
      onMouseLeave={onMouseLeave}
    >
      <div
        style={{
          width: "120px",
          height: "36px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
        onMouseEnter={() => setIsExpanded(true)}
        onMouseLeave={() => setIsExpanded(false)}
      >
        <button
          style={{
            display: "flex",
            alignItems: "center",
            gap: isExpanded ? "4px" : "0px",
            padding: isExpanded ? "4px 8px" : "0px",
            width: isExpanded ? "auto" : "20px",
            height: isExpanded ? "auto" : "20px",
            justifyContent: "center",
            backgroundColor: OVERLAY_COLORS.selected,
            color: "white",
            border: "none",
            borderRadius: "9999px",
            fontSize: "12px",
            fontWeight: 500,
            cursor: "pointer",
            whiteSpace: "nowrap",
            transition: "all 150ms ease",
          }}
          onClick={onClick}
        >
          <span style={{ lineHeight: 1 }}>+</span>
          {isExpanded && <span>Add block</span>}
        </button>
      </div>
    </div>
  );
};
