import type { Block } from "./createBlock";

interface CreateAppOptions {
  blocks: Block[];
}

export function createApp({ blocks }: CreateAppOptions) {
  const blocksMap = new Map<string, Block>();

  for (const block of blocks) {
    blocksMap.set(block.id, block);
  }

  return {
    getBlocks() {
      return Array.from(blocksMap.values());
    },
    getBlockById(id: string) {
      return blocksMap.get(id);
    },
    getSerializableDefinitions() {
      return Array.from(blocksMap.values()).map((block) => ({
        blockId: block.id,
        title: block.title,
        description: block.description,
        contentSchema: block.contentSchema,
        settingsSchema: block.settingsSchema,
      }));
    },
  };
}

export type CamoxApp = ReturnType<typeof createApp>;
