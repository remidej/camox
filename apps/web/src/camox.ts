import { createApp } from 'camox/createApp';
import type { Block } from 'camox/createBlock';
import type { Template } from 'camox/createTemplate';

// Auto-import all blocks from the blocks directory
const blockModules = import.meta.glob<{ block: Block }>('./blocks/*.{ts,tsx}', {
  eager: true,
});
const blocks = Object.values(blockModules).map((mod) => mod.block);

// Auto-import all templates from the templates directory
const templateModules = import.meta.glob<{ template: Template }>(
  './templates/*.{ts,tsx}',
  { eager: true },
);
const templates = Object.values(templateModules).map((mod) => mod.template);

export const camoxApp = createApp({
  blocks,
  templates,
});
