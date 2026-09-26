import { authed, pub } from "../../orpc";
import * as service from "./service";

// Studio browsing is authenticated; record authoring remains unrouted.
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
  sync: pub
    .input(service.syncCollectionDefinitionsInput)
    .handler(({ context, input }) => service.syncCollectionDefinitions(context, input)),
};
