import * as React from "react";
import { applyModifierRendering } from "./modifiers";

export function lexicalStateToReactNodes(serialized: string): React.ReactNode {
  try {
    const parsed = JSON.parse(serialized);
    return renderNode(parsed.root);
  } catch {
    return serialized;
  }
}

function renderNode(node: any): React.ReactNode {
  if (node.type === "text") {
    return applyModifierRendering(node.text ?? "", node.format ?? 0);
  }
  if (node.type === "linebreak") return <br />;
  if (!node.children) return null;

  const children = node.children.map((child: any, i: number) => (
    <React.Fragment key={i}>{renderNode(child)}</React.Fragment>
  ));

  if (node.type === "root") {
    // For root with a single paragraph, return children directly (no wrapper)
    if (node.children.length === 1) {
      return renderNode(node.children[0]);
    }
    return children;
  }

  // For paragraph/heading nodes, return inline content directly
  return children;
}
