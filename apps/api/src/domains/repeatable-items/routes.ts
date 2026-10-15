import { runService } from "../../lib/run-service";
import { authed, pub } from "../../orpc";
import { draftScopeOfBlock, inScope } from "../blocks/draft-scope";
import * as service from "./service";

// Public procedures

const get = pub
  .input(service.getRepeatableItemInput)
  .handler(({ context, input }) => runService(service.getRepeatableItem(context, input)));

// Protected procedures

const create = authed
  .input(service.createRepeatableItemInput)
  .handler(({ context, input }) =>
    inScope(draftScopeOfBlock(context, input.blockId), (scope) =>
      service.createRepeatableItem(context, input, scope),
    ),
  );

const updateContent = authed
  .input(service.updateRepeatableItemContentInput)
  .handler(({ context, input }) => runService(service.updateRepeatableItemContent(context, input)));

const updateSettings = authed
  .input(service.updateRepeatableItemSettingsInput)
  .handler(({ context, input }) =>
    runService(service.updateRepeatableItemSettings(context, input)),
  );

const updatePosition = authed
  .input(service.updateRepeatableItemPositionInput)
  .handler(({ context, input }) =>
    runService(service.updateRepeatableItemPosition(context, input)),
  );

const duplicate = authed
  .input(service.duplicateRepeatableItemInput)
  .handler(({ context, input }) => runService(service.duplicateRepeatableItem(context, input)));

const generateSummary = authed
  .input(service.generateRepeatableItemSummaryInput)
  .handler(({ context, input }) =>
    runService(service.generateRepeatableItemSummary(context, input)),
  );

const deleteFn = authed
  .input(service.deleteRepeatableItemInput)
  .handler(({ context, input }) => runService(service.deleteRepeatableItem(context, input)));

export const repeatableItemProcedures = {
  get,
  create,
  updateContent,
  updateSettings,
  updatePosition,
  duplicate,
  generateSummary,
  delete: deleteFn,
};
