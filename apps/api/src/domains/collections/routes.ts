import { authed, pub } from "../../orpc";
import * as service from "./service";

// Studio reads and draft authoring are authenticated.
export const collectionDefinitionProcedures = {
  list: authed
    .input(service.listCollectionDefinitionsInput)
    .handler(({ context, input }) => service.listCollectionDefinitions(context, input)),
  get: authed
    .input(service.getCollectionDefinitionInput)
    .handler(({ context, input }) => service.getCollectionDefinition(context, input)),
  listRecords: authed
    .input(service.listCollectionRecordsInput)
    .handler(({ context, input }) => service.listCollectionRecords(context, input)),
  getRecord: authed
    .input(service.getCollectionRecordInput)
    .handler(({ context, input }) => service.getCollectionRecord(context, input)),
  createRecord: authed
    .input(service.createRecordInput)
    .handler(({ context, input }) => service.createRecord(context, input)),
  editRecord: authed
    .input(service.editRecordInput)
    .handler(({ context, input }) => service.editRecord(context, input)),
  deleteRecord: authed
    .input(service.deleteRecordInput)
    .handler(({ context, input }) => service.deleteRecord(context, input)),
  sync: pub
    .input(service.syncCollectionDefinitionsInput)
    .handler(({ context, input }) => service.syncCollectionDefinitions(context, input)),
};
