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
  getRecordUsageCount: authed
    .input(service.getRecordUsageCountInput)
    .handler(({ context, input }) => runService(service.getRecordUsageCount(context, input))),
  // Public: serves visitors' record pages.
  findRecordsByField: pub
    .input(service.findRecordsByFieldInput)
    .handler(({ context, input }) => runService(service.findRecordsByField(context, input))),
  // Public like findRecordsByField: route discovery for record pages.
  listRecordPageValues: pub
    .input(service.listRecordPageValuesInput)
    .handler(({ context, input }) => runService(service.listRecordPageValues(context, input))),
  // Public: a record page's Markdown.
  recordMarkdown: pub
    .input(service.recordMarkdownInput)
    .handler(({ context, input }) => runService(service.recordMarkdown(context, input))),
  createRecord: authed
    .input(service.createRecordInput)
    .handler(({ context, input }) => runService(service.createRecord(context, input))),
  editRecord: authed
    .input(service.editRecordInput)
    .handler(({ context, input }) => runService(service.editRecord(context, input))),
  deleteRecord: authed
    .input(service.deleteRecordInput)
    .handler(({ context, input }) => runService(service.deleteRecord(context, input))),
  sync: pub
    .input(service.syncCollectionDefinitionsInput)
    .handler(({ context, input }) => runService(service.syncCollectionDefinitions(context, input))),
};
