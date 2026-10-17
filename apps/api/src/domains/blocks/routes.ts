import { authed, contentWrite, pub } from "../../orpc";
import {
  inScope,
  projectOfBlock,
  projectOfPage,
  projectOfSlug,
  inWriteDraft,
} from "../drafts/request-scope";
import * as service from "./service";

// Public procedures

const get = pub
  .input(service.getBlockInput)
  .handler(({ context, input }) =>
    inScope(context, projectOfBlock(context, input.id), (scope) =>
      service.getBlock(context, input, scope),
    ),
  );

const getPageMarkdown = pub
  .input(service.getPageMarkdownInput)
  .handler(({ context, input }) =>
    inScope(context, projectOfPage(context, input.pageId), (scope) =>
      service.getPageMarkdown(context, input, scope),
    ),
  );

const getLayoutMarkdown = pub
  .input(service.getLayoutMarkdownInput)
  .handler(({ context, input }) =>
    inScope(context, projectOfSlug(context, input.projectSlug), (scope) =>
      service.getLayoutMarkdown(context, input, scope),
    ),
  );

const getUsageCounts = pub
  .input(service.getBlocksUsageCountsInput)
  .handler(({ context, input }) =>
    inScope(context, input.projectId, (scope) =>
      service.getBlocksUsageCounts(context, input, scope),
    ),
  );

const getPagesUsing = pub
  .input(service.blockTypeInput)
  .handler(({ context, input }) =>
    inScope(context, input.projectId, (scope) => service.getPagesUsingBlock(context, input, scope)),
  );

const getSyncedContent = pub
  .input(service.blockTypeInput)
  .handler(({ context, input }) =>
    inScope(context, input.projectId, (scope) =>
      service.getSyncedBlockContent(context, input, scope),
    ),
  );

// Protected procedures

const create = contentWrite
  .input(service.createBlockInput)
  .handler(({ context, input }) =>
    inWriteDraft(context, projectOfPage(context, input.pageId), (scope) =>
      service.createBlock(context, input, scope),
    ),
  );

const updateContent = contentWrite
  .input(service.updateBlockContentInput)
  .handler(({ context, input }) =>
    inWriteDraft(context, projectOfBlock(context, input.id), (scope) =>
      service.updateBlockContent(context, input, scope),
    ),
  );

const updateSettings = contentWrite
  .input(service.updateBlockSettingsInput)
  .handler(({ context, input }) =>
    inWriteDraft(context, projectOfBlock(context, input.id), (scope) =>
      service.updateBlockSettings(context, input, scope),
    ),
  );

const updatePosition = contentWrite
  .input(service.updateBlockPositionInput)
  .handler(({ context, input }) =>
    inWriteDraft(context, projectOfBlock(context, input.id), (scope) =>
      service.updateBlockPosition(context, input, scope),
    ),
  );

// fn suffix because delete is a reserved keyword
const deleteFn = contentWrite
  .input(service.deleteBlockInput)
  .handler(({ context, input }) =>
    inWriteDraft(context, projectOfBlock(context, input.id), (scope) =>
      service.deleteBlock(context, input, scope),
    ),
  );

// The draft is resolved on the first block's project; the service rejects blocks of another.
const deleteManyFn = contentWrite.input(service.deleteBlocksInput).handler(({ context, input }) => {
  const [first] = input.blockIds;
  if (!first) return [];
  return inWriteDraft(context, projectOfBlock(context, first), (scope) =>
    service.deleteBlocks(context, input, scope),
  );
});

const generateSummary = authed
  .input(service.generateBlockSummaryInput)
  .handler(({ context, input }) =>
    inScope(context, projectOfBlock(context, input.id), (scope) =>
      service.generateBlockSummary(context, input, scope),
    ),
  );

const duplicate = contentWrite
  .input(service.duplicateBlockInput)
  .handler(({ context, input }) =>
    inWriteDraft(context, projectOfBlock(context, input.id), (scope) =>
      service.duplicateBlock(context, input, scope),
    ),
  );

export const blockProcedures = {
  get,
  getPageMarkdown,
  getLayoutMarkdown,
  getUsageCounts,
  getPagesUsing,
  getSyncedContent,
  create,
  updateContent,
  updateSettings,
  updatePosition,
  delete: deleteFn,
  deleteMany: deleteManyFn,
  generateSummary,
  duplicate,
};
