export const OVERLAY_COLORS = {
  hover: "#F472B6BF", // pink400 at 75% opacity
  selected: "#F472B6", // pink400
} as const;

export const OVERLAY_WIDTHS = {
  hover: "3px",
  selected: "1px",
} as const;

export const OVERLAY_OFFSETS = {
  fieldHover: "1px", // outlineOffset for fields on hover
  fieldSelected: "2px", // outlineOffset for fields when selected
  blockHover: "-1px", // inset for block/repeater overlay on hover
  blockSelected: "0px", // inset for block overlay when selected
} as const;
