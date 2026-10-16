import { authed, contentWrite, pub } from "../../orpc";
import { inScope, projectOfBlock, projectOfItem } from "../drafts/request-scope";
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

const create = contentWrite
  .input(service.createRepeatableItemInput)
  .handler(({ context, input }) =>
    inScope(context, projectOfBlock(context, input.blockId), (scope) =>
      service.createRepeatableItem(context, input, scope),
    ),
  );

const updateContent = contentWrite
  .input(service.updateRepeatableItemContentInput)
  .handler(({ context, input }) =>
    inScope(context, projectOfItem(context, input.id), (scope) =>
      service.updateRepeatableItemContent(context, input, scope),
    ),
  );

const updateSettings = contentWrite
  .input(service.updateRepeatableItemSettingsInput)
  .handler(({ context, input }) =>
    inScope(context, projectOfItem(context, input.id), (scope) =>
      service.updateRepeatableItemSettings(context, input, scope),
    ),
  );

const updatePosition = contentWrite
  .input(service.updateRepeatableItemPositionInput)
  .handler(({ context, input }) =>
    inScope(context, projectOfItem(context, input.id), (scope) =>
      service.updateRepeatableItemPosition(context, input, scope),
    ),
  );

const duplicate = contentWrite
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

const deleteFn = contentWrite
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
