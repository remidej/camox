import { runService } from "../../lib/run-service";
import { authed } from "../../orpc";
import * as list from "./list";
import * as overviewJob from "./overview-job";
import * as publish from "./publish";

// Every procedure but `list` and `create` acts on the draft the request names through
// `x-camox-draft` (ADR 0011).

const listDrafts = authed
  .input(list.listInput)
  .handler(({ context, input }) => runService(list.listDrafts(context, input)));

const create = authed
  .input(list.createInput)
  .handler(({ context, input }) => runService(list.createDraft(context, input)));

const get = authed
  .input(list.getInput)
  .handler(({ context, input }) => runService(list.getDraft(context, input)));

const previewPublish = authed
  .input(publish.previewPublishInput)
  .handler(({ context, input }) => runService(publish.previewPublish(context, input)));

const publishDraft = authed
  .input(publish.publishInput)
  .handler(({ context, input }) => runService(publish.publishDraft(context, input)));

const retryOverview = authed
  .input(overviewJob.retryOverviewInput)
  .handler(({ context, input }) => runService(overviewJob.retryOverview(context, input)));

const deleteDraft = authed
  .input(publish.deleteInput)
  .handler(({ context, input }) => runService(publish.deleteDraft(context, input)));

const revertToLive = authed
  .input(publish.revertToLiveInput)
  .handler(({ context, input }) => runService(publish.revertToLive(context, input)));

export const draftProcedures = {
  list: listDrafts,
  create,
  get,
  previewPublish,
  retryOverview,
  publish: publishDraft,
  delete: deleteDraft,
  revertToLive,
};
