import { runService } from "../../lib/run-service";
import { authed } from "../../orpc";
import * as publish from "./publish";

// Every procedure acts on the draft the request names through `x-camox-draft` (ADR 0011).

const previewPublish = authed
  .input(publish.previewPublishInput)
  .handler(({ context, input }) => runService(publish.previewPublish(context, input)));

const publishDraft = authed
  .input(publish.publishInput)
  .handler(({ context, input }) => runService(publish.publishDraft(context, input)));

const discard = authed
  .input(publish.discardInput)
  .handler(({ context, input }) => runService(publish.discardDraft(context, input)));

export const draftProcedures = {
  previewPublish,
  publish: publishDraft,
  discard,
};
