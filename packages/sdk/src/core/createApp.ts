import type { Block } from "./createBlock";
import type { Template } from "./createTemplate";

interface CreateAppOptions {
  blocks: Block[];
  templates?: Template[];
}

export function createApp({ blocks, templates = [] }: CreateAppOptions) {
  const blocksMap = new Map<string, Block>();
  const templatesMap = new Map<string, Template>();

  for (const block of blocks) {
    blocksMap.set(block.id, block);
  }

  for (const template of templates) {
    templatesMap.set(template.id, template);
  }

  return {
    getBlocks() {
      return Array.from(blocksMap.values());
    },
    getBlockById(id: string) {
      return blocksMap.get(id);
    },
    getTemplates() {
      return Array.from(templatesMap.values());
    },
    getTemplateById(id: string) {
      return templatesMap.get(id);
    },
    getSerializableDefinitions() {
      return Array.from(blocksMap.values()).map((block) => ({
        blockId: block.id,
        title: block.title,
        description: block.description,
        contentSchema: block.contentSchema,
        settingsSchema: block.settingsSchema,
        templateOnly: block.templateOnly || undefined,
      }));
    },
    getSerializableTemplateDefinitions() {
      return Array.from(templatesMap.values()).map((template) => ({
        templateId: template.id,
        blocks: template.blockDefinitions,
      }));
    },
  };
}

export type CamoxApp = ReturnType<typeof createApp>;
