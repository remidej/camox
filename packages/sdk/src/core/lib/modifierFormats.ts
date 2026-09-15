/** Format bitmask flags matching Lexical's internal constants */
export const FORMAT_FLAGS = {
  bold: 1,
  italic: 2,
  underline: 8,
  // UI selection bit only. Gradient is an inline element, not a Lexical text format.
  gradient: 1 << 20,
} as const;

/** Markdown wrappers keyed by format name */
export const MARKDOWN_WRAPPERS: Record<string, (text: string) => string> = {
  bold: (text) => `**${text}**`,
  italic: (text) => `*${text}*`,
  underline: (text) => `<u>${text}</u>`,
};

export function lexicalTextToMarkdown(text: string, format: number): string {
  let result = text.replace(/[\\*_[\]<>]/g, "\\$&");
  for (const [key, wrapper] of Object.entries(MARKDOWN_WRAPPERS)) {
    const flag = FORMAT_FLAGS[key as keyof typeof FORMAT_FLAGS];
    if (flag && format & flag) {
      result = wrapper(result);
    }
  }
  return result;
}
