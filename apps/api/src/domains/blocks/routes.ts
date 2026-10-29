import { runService } from "../../lib/run-service";
import { authed, contentWrite, pub } from "../../orpc";
import * as service from "./service";

// Public procedures

const get = pub
  .input(service.getBlockInput)
  .handler(({ context, input }) => runService(service.getBlock(context, input)));

const getPageMarkdown = pub
  .input(service.getPageMarkdownInput)
  .handler(({ context, input }) => runService(service.getPageMarkdown(context, input)));

const getLayoutMarkdown = pub
  .input(service.getLayoutMarkdownInput)
  .handler(({ context, input }) => runService(service.getLayoutMarkdown(context, input)));

const getUsageCounts = pub
  .input(service.getBlocksUsageCountsInput)
  .handler(({ context, input }) => runService(service.getBlocksUsageCounts(context, input)));

const getPagesUsing = pub
  .input(service.blockTypeInput)
  .handler(({ context, input }) => runService(service.getPagesUsingBlock(context, input)));

const getSyncedContent = pub
  .input(service.blockTypeInput)
  .handler(({ context, input }) => runService(service.getSyncedBlockContent(context, input)));

/** A Block Definition's block with overrides, unplaced: what the agent's `look` shows of it. */
const getUnplaced = pub
  .input(service.getUnplacedBlockInput)
  .handler(({ context, input }) => runService(service.getUnplacedBlock(context, input)));

// Protected procedures

const create = contentWrite
  .input(service.createBlockInput)
  .handler(({ context, input }) => runService(service.createBlock(context, input)));

const updateContent = contentWrite
  .input(service.updateBlockContentInput)
  .handler(({ context, input }) => runService(service.updateBlockContent(context, input)));

const updateSettings = contentWrite
  .input(service.updateBlockSettingsInput)
  .handler(({ context, input }) => runService(service.updateBlockSettings(context, input)));

const updatePosition = contentWrite
  .input(service.updateBlockPositionInput)
  .handler(({ context, input }) => runService(service.updateBlockPosition(context, input)));

// fn suffix because delete is a reserved keyword
const deleteFn = contentWrite
  .input(service.deleteBlockInput)
  .handler(({ context, input }) => runService(service.deleteBlock(context, input)));

const deleteManyFn = contentWrite
  .input(service.deleteBlocksInput)
  .handler(({ context, input }) => runService(service.deleteBlocks(context, input)));

const generateSummary = authed
  .input(service.generateBlockSummaryInput)
  .handler(({ context, input }) => runService(service.generateBlockSummary(context, input)));

const duplicate = contentWrite
  .input(service.duplicateBlockInput)
  .handler(({ context, input }) => runService(service.duplicateBlock(context, input)));

export const blockProcedures = {
  get,
  getPageMarkdown,
  getLayoutMarkdown,
  getUsageCounts,
  getPagesUsing,
  getSyncedContent,
  getUnplaced,
  create,
  updateContent,
  updateSettings,
  updatePosition,
  delete: deleteFn,
  deleteMany: deleteManyFn,
  generateSummary,
  duplicate,
};
