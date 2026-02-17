import { createApp } from 'camox/createApp';
import type { Block } from 'camox/createBlock';

// Auto-import all blocks from the blocks directory
const modules = import.meta.glob<{ block: Block }>('./blocks/*.{ts,tsx}', {
  eager: true,
});
const blocks = Object.values(modules).map((mod) => mod.block);

export const camoxApp = createApp({
  blocks,
});
