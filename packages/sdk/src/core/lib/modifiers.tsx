import * as React from "react";
import { FORMAT_FLAGS } from "./modifierFormats";

export { lexicalTextToMarkdown } from "./modifierFormats";

export interface TextModifier {
  formatFlag: number;
  label: string;
  icon: string;
  render: (children: React.ReactNode) => React.ReactNode;
  toMarkdown: (text: string) => string;
}

export const TEXT_MODIFIERS: Record<string, TextModifier> = {
  bold: {
    formatFlag: FORMAT_FLAGS.bold,
    label: "Bold",
    icon: "B",
    render: (children) => <strong>{children}</strong>,
    toMarkdown: (text) => `**${text}**`,
  },
  italic: {
    formatFlag: FORMAT_FLAGS.italic,
    label: "Italic",
    icon: "I",
    render: (children) => <em>{children}</em>,
    toMarkdown: (text) => `*${text}*`,
  },
};

export function applyModifierRendering(
  text: string,
  format: number,
): React.ReactNode {
  let node: React.ReactNode = text;
  for (const modifier of Object.values(TEXT_MODIFIERS)) {
    if (format & modifier.formatFlag) {
      node = modifier.render(node);
    }
  }
  return node;
}
