import * as React from "react";

import { getImagePlaceholderTitle, isImagePlaceholder, type ImageValue } from "./contentType";

const presentationProps = new Set([
  "id",
  "className",
  "style",
  "width",
  "height",
  "title",
  "role",
  "tabIndex",
  "hidden",
  "dir",
  "lang",
]);

const landscapeLayers = [
  {
    path: "M0 680 190 470 280 520 560 180 650 330 720 290 1020 610 1200 550V800H0Z",
    shade: 5,
  },
  {
    path: "M0 500Q180 350 380 470T780 490Q1000 350 1200 460V800H0Z",
    shade: 9,
  },
  {
    path: "M0 590Q200 690 440 550T850 570Q1040 650 1200 530V800H0Z",
    shade: 14,
  },
  {
    path: "M0 650Q160 580 330 660T660 650Q850 590 1010 480L1200 390V800H0Z",
    shade: 20,
  },
];

// The contract each website's stylesheet sets for empty images. Declaring them
// on every color scheme selector lets a placeholder in a dark block resolve dark.
const placeholderFill = "var(--camox-placeholder, #f1f3f5)";
const placeholderInk = "var(--camox-placeholder-ink, #64748b)";

function PlaceholderLandscape() {
  const id = React.useId();

  // Mixing the placeholder color with opaque slate shades the terrain without
  // letting any of the rear silhouettes show through the foreground.
  return (
    <g style={{ color: placeholderFill }}>
      <defs>
        {landscapeLayers.map(({ shade }, index) => (
          <linearGradient key={index} id={`${id}-hill-${index}`} x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0"
              stopColor={`color-mix(in oklab, currentColor ${100 - shade}%, #64748b)`}
            />
            <stop
              offset="1"
              stopColor={`color-mix(in oklab, currentColor ${104 - shade}%, #64748b)`}
            />
          </linearGradient>
        ))}
      </defs>
      {landscapeLayers.map(({ path }, index) => (
        <path key={index} d={path} fill={`url(#${id}-hill-${index})`} />
      ))}
    </g>
  );
}

/**
 * Run after the author's callback. Only direct images of explicitly synthesized
 * assets are replaced; picture elements, wrappers and custom components retain
 * their URL fallback. Refs and event handlers also keep the image intact rather
 * than silently dropping behavior or handing callers an incompatible SVG node.
 */
export function renderImagePlaceholder(
  value: ImageValue,
  rendered: React.ReactNode,
): React.ReactNode {
  if (!isImagePlaceholder(value)) return rendered;
  if (!React.isValidElement<React.ImgHTMLAttributes<HTMLImageElement>>(rendered)) return rendered;
  if (rendered.type !== "img") return rendered;

  const props = rendered.props;
  if (
    Object.entries(props).some(
      ([name, value]) =>
        value != null &&
        (name === "ref" || /^on[A-Z]/.test(name) || name === "useMap" || name === "isMap"),
    )
  )
    return rendered;
  const svgProps: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(props)) {
    if (presentationProps.has(name) || name.startsWith("aria-") || name.startsWith("data-")) {
      svgProps[name] = value;
    }
  }
  const hasLabel = Boolean(props["aria-label"] || props["aria-labelledby"] || props.alt);
  const decorative = props["aria-hidden"] === true || props["aria-hidden"] === "true" || !hasLabel;

  return (
    <svg
      key={rendered.key}
      xmlns="http://www.w3.org/2000/svg"
      width={1200}
      // Unlike img, inline SVG does not receive image resets such as Tailwind's
      // height:auto. A definite height prevents width/aspect-ratio utilities
      // from sizing it. Use a presentation attribute so author CSS still wins.
      height="auto"
      viewBox="0 0 1200 800"
      preserveAspectRatio="xMidYMid slice"
      role={decorative ? undefined : "img"}
      aria-label={props["aria-labelledby"] ? undefined : props.alt || undefined}
      aria-hidden={decorative ? true : undefined}
      focusable="false"
      {...svgProps}
    >
      <rect width="1200" height="800" style={{ fill: placeholderFill }} />
      <PlaceholderLandscape />
      <foreignObject x="60" y="300" width="1080" height="200">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            fontFamily: "inherit",
            fontSize: 48,
          }}
        >
          <span
            style={{
              display: "block",
              maxWidth: "100%",
              color: placeholderFill,
              background: "currentColor",
              borderRadius: 16,
              padding: "16px 28px",
            }}
          >
            <span
              style={{
                color: placeholderInk,
                display: "block",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                lineHeight: 1.25,
                userSelect: "none",
              }}
            >
              {getImagePlaceholderTitle(value)}
            </span>
          </span>
        </div>
      </foreignObject>
    </svg>
  );
}
