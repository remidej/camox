import { authed, pub } from "../../orpc";
import { inScope, projectOfBlock, projectOfItem } from "../blocks/draft-scope";
import * as service from "./service";

// Every procedure reads and writes items in the draft the request names (ADR 0011).

// Public procedures

const get = pub
  .input(service.getRepeatableItemInput)
  .handler(({ context, input }) =>
    inScope(context, projectOfItem(context, input.id), (scope) =>
      service.getRepeatableItem(context, input, scope),
    ),
  );

// Protected procedures

const create = authed
  .input(service.createRepeatableItemInput)
  .handler(({ context, input }) =>
    inScope(context, projectOfBlock(context, input.blockId), (scope) =>
      service.createRepeatableItem(context, input, scope),
    ),
  );

const updateContent = authed
  .input(service.updateRepeatableItemContentInput)
  .handler(({ context, input }) =>
    inScope(context, projectOfItem(context, input.id), (scope) =>
      service.updateRepeatableItemContent(context, input, scope),
    ),
  );

const updateSettings = authed
  .input(service.updateRepeatableItemSettingsInput)
  .handler(({ context, input }) =>
    inScope(context, projectOfItem(context, input.id), (scope) =>
      service.updateRepeatableItemSettings(context, input, scope),
    ),
  );

const updatePosition = authed
  .input(service.updateRepeatableItemPositionInput)
  .handler(({ context, input }) =>
    inScope(context, projectOfItem(context, input.id), (scope) =>
      service.updateRepeatableItemPosition(context, input, scope),
    ),
  );

const duplicate = authed
  .input(service.duplicateRepeatableItemInput)
  .handler(({ context, input }) =>
    inScope(context, projectOfItem(context, input.id), (scope) =>
      service.duplicateRepeatableItem(context, input, scope),
    ),
  );

const generateSummary = authed
  .input(service.generateRepeatableItemSummaryInput)
  .handler(({ context, input }) =>
    inScope(context, projectOfItem(context, input.id), (scope) =>
      service.generateRepeatableItemSummary(context, input, scope),
    ),
  );

const deleteFn = authed
  .input(service.deleteRepeatableItemInput)
  .handler(({ context, input }) =>
    inScope(context, projectOfItem(context, input.id), (scope) =>
      service.deleteRepeatableItem(context, input, scope),
    ),
  );

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
