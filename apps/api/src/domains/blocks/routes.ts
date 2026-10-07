import { runService } from "../../lib/run-service";
import { authed, pub } from "../../orpc";
import * as service from "./service";

// Public procedures

const get = pub
  .input(service.getBlockInput)
  .handler(({ context, input }) => runService(service.getBlock(context, input)));

const getPageMarkdown = pub
  .input(service.getPageMarkdownInput)
  .handler(({ context, input }) => runService(service.getPageMarkdown(context, input)));

const getUsageCounts = pub
  .input(service.getBlocksUsageCountsInput)
  .handler(({ context, input }) => runService(service.getBlocksUsageCounts(context, input)));

// Protected procedures

const create = authed
  .input(service.createBlockInput)
  .handler(({ context, input }) => runService(service.createBlock(context, input)));

const updateContent = authed
  .input(service.updateBlockContentInput)
  .handler(({ context, input }) => runService(service.updateBlockContent(context, input)));

const updateSettings = authed
  .input(service.updateBlockSettingsInput)
  .handler(({ context, input }) => runService(service.updateBlockSettings(context, input)));

const updatePosition = authed
  .input(service.updateBlockPositionInput)
  .handler(({ context, input }) => runService(service.updateBlockPosition(context, input)));

// fn suffix because delete is a reserved keyword
const deleteFn = authed
  .input(service.deleteBlockInput)
  .handler(({ context, input }) => runService(service.deleteBlock(context, input)));

const deleteManyFn = authed
  .input(service.deleteBlocksInput)
  .handler(({ context, input }) => runService(service.deleteBlocks(context, input)));

const generateSummary = authed
  .input(service.generateBlockSummaryInput)
  .handler(({ context, input }) => runService(service.generateBlockSummary(context, input)));

const duplicate = authed
  .input(service.duplicateBlockInput)
  .handler(({ context, input }) => runService(service.duplicateBlock(context, input)));

export const blockProcedures = {
  get,
  getPageMarkdown,
  getUsageCounts,
  create,
  updateContent,
  updateSettings,
  updatePosition,
  delete: deleteFn,
  deleteMany: deleteManyFn,
  generateSummary,
  duplicate,
};
