/** Format bitmask flags matching Lexical's internal constants */
export const FORMAT_FLAGS = {
  bold: 1,
  italic: 2,
} as const;

/** Markdown wrappers keyed by format name */
export const MARKDOWN_WRAPPERS: Record<string, (text: string) => string> = {
  bold: (text) => `**${text}**`,
  italic: (text) => `*${text}*`,
};

export function lexicalTextToMarkdown(text: string, format: number): string {
  let result = text;
  for (const [key, wrapper] of Object.entries(MARKDOWN_WRAPPERS)) {
    const flag = FORMAT_FLAGS[key as keyof typeof FORMAT_FLAGS];
    if (flag && format & flag) {
      result = wrapper(result);
    }
  }
  return result;
}
