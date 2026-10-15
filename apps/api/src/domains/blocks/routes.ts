import { Effect } from "effect";

import { runService } from "../../lib/run-service";
import { authed, pub } from "../../orpc";
import {
  draftScopeOfBlock,
  draftScopeOfPage,
  draftScopeOfProject,
  draftScopeOfProjectSlug,
  inScope,
} from "./draft-scope";
import * as service from "./service";

// Public procedures

const get = pub
  .input(service.getBlockInput)
  .handler(({ context, input }) =>
    inScope(draftScopeOfBlock(context, input.id), (scope) =>
      service.getBlock(context, input, scope),
    ),
  );

const getPageMarkdown = pub
  .input(service.getPageMarkdownInput)
  .handler(({ context, input }) =>
    inScope(draftScopeOfPage(context, input.pageId), (scope) =>
      service.getPageMarkdown(context, input, scope),
    ),
  );

const getLayoutMarkdown = pub
  .input(service.getLayoutMarkdownInput)
  .handler(({ context, input }) =>
    inScope(draftScopeOfProjectSlug(context, input.projectSlug), (scope) =>
      service.getLayoutMarkdown(context, input, scope),
    ),
  );

const getUsageCounts = pub
  .input(service.getBlocksUsageCountsInput)
  .handler(({ context, input }) =>
    inScope(draftScopeOfProject(context, input.projectId), (scope) =>
      service.getBlocksUsageCounts(context, input, scope),
    ),
  );

const getPagesUsing = pub
  .input(service.blockTypeInput)
  .handler(({ context, input }) =>
    inScope(draftScopeOfProject(context, input.projectId), (scope) =>
      service.getPagesUsingBlock(context, input, scope),
    ),
  );

// Shared content lives in Live until it moves into drafts (#238).
const getSyncedContent = pub
  .input(service.blockTypeInput)
  .handler(({ context, input }) => runService(service.getSyncedBlockContent(context, input)));

// Protected procedures

const create = authed
  .input(service.createBlockInput)
  .handler(({ context, input }) =>
    inScope(draftScopeOfPage(context, input.pageId), (scope) =>
      service.createBlock(context, input, scope),
    ),
  );

const updateContent = authed
  .input(service.updateBlockContentInput)
  .handler(({ context, input }) =>
    inScope(draftScopeOfBlock(context, input.id), (scope) =>
      service.updateBlockContent(context, input, scope),
    ),
  );

const updateSettings = authed
  .input(service.updateBlockSettingsInput)
  .handler(({ context, input }) =>
    inScope(draftScopeOfBlock(context, input.id), (scope) =>
      service.updateBlockSettings(context, input, scope),
    ),
  );

const updatePosition = authed
  .input(service.updateBlockPositionInput)
  .handler(({ context, input }) =>
    inScope(draftScopeOfBlock(context, input.id), (scope) =>
      service.updateBlockPosition(context, input, scope),
    ),
  );

// fn suffix because delete is a reserved keyword
const deleteFn = authed
  .input(service.deleteBlockInput)
  .handler(({ context, input }) =>
    inScope(draftScopeOfBlock(context, input.id), (scope) =>
      service.deleteBlock(context, input, scope),
    ),
  );

// The draft is resolved on the first block's project; the service rejects blocks of another.
const deleteManyFn = authed.input(service.deleteBlocksInput).handler(({ context, input }) => {
  const [first] = input.blockIds;
  const scope = first ? draftScopeOfBlock(context, first) : Effect.succeed(null);
  return inScope(scope, (scope) => service.deleteBlocks(context, input, scope));
});

const generateSummary = authed
  .input(service.generateBlockSummaryInput)
  .handler(({ context, input }) =>
    inScope(draftScopeOfBlock(context, input.id), (scope) =>
      service.generateBlockSummary(context, input, scope),
    ),
  );

const duplicate = authed
  .input(service.duplicateBlockInput)
  .handler(({ context, input }) =>
    inScope(draftScopeOfBlock(context, input.id), (scope) =>
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
