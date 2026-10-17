import { runService } from "../../lib/run-service";
import { authed, contentWrite, pub } from "../../orpc";
import * as service from "./service";

// Every procedure reads and writes items in the draft the request names (ADR 0011).

// Public procedures

const get = pub
  .input(service.getRepeatableItemInput)
  .handler(({ context, input }) => runService(service.getRepeatableItem(context, input)));

// Protected procedures

const create = contentWrite
  .input(service.createRepeatableItemInput)
  .handler(({ context, input }) => runService(service.createRepeatableItem(context, input)));

const updateContent = contentWrite
  .input(service.updateRepeatableItemContentInput)
  .handler(({ context, input }) => runService(service.updateRepeatableItemContent(context, input)));

const updateSettings = contentWrite
  .input(service.updateRepeatableItemSettingsInput)
  .handler(({ context, input }) =>
    runService(service.updateRepeatableItemSettings(context, input)),
  );

const updatePosition = contentWrite
  .input(service.updateRepeatableItemPositionInput)
  .handler(({ context, input }) =>
    runService(service.updateRepeatableItemPosition(context, input)),
  );

const duplicate = contentWrite
  .input(service.duplicateRepeatableItemInput)
  .handler(({ context, input }) => runService(service.duplicateRepeatableItem(context, input)));

const generateSummary = authed
  .input(service.generateRepeatableItemSummaryInput)
  .handler(({ context, input }) =>
    runService(service.generateRepeatableItemSummary(context, input)),
  );

const deleteFn = contentWrite
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
