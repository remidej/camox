import { runService } from "../../lib/run-service";
import { authed, pub } from "../../orpc";
import * as service from "./service";

// Studio reads and draft authoring are authenticated.
export const collectionDefinitionProcedures = {
  list: authed
    .input(service.listCollectionDefinitionsInput)
    .handler(({ context, input }) => runService(service.listCollectionDefinitions(context, input))),
  get: authed
    .input(service.getCollectionDefinitionInput)
    .handler(({ context, input }) => runService(service.getCollectionDefinition(context, input))),
  listRecords: authed
    .input(service.listCollectionRecordsInput)
    .handler(({ context, input }) => runService(service.listCollectionRecords(context, input))),
  getRecord: authed
    .input(service.getCollectionRecordInput)
    .handler(({ context, input }) => runService(service.getCollectionRecord(context, input))),
  createRecord: authed
    .input(service.createRecordInput)
    .handler(({ context, input }) => runService(service.createRecord(context, input))),
  editRecord: authed
    .input(service.editRecordInput)
    .handler(({ context, input }) => runService(service.editRecord(context, input))),
  deleteRecord: authed
    .input(service.deleteRecordInput)
    .handler(({ context, input }) => runService(service.deleteRecord(context, input))),
  publishRecord: authed
    .input(service.publishRecordInput)
    .handler(({ context, input }) => runService(service.publishRecord(context, input))),
  unpublishRecord: authed
    .input(service.unpublishRecordInput)
    .handler(({ context, input }) => runService(service.unpublishRecord(context, input))),
  discardRecord: authed
    .input(service.discardRecordInput)
    .handler(({ context, input }) => runService(service.discardRecord(context, input))),
  sync: pub
    .input(service.syncCollectionDefinitionsInput)
    .handler(({ context, input }) => runService(service.syncCollectionDefinitions(context, input))),
};
