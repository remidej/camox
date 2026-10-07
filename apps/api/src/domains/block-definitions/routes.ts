import { runService } from "../../lib/run-service";
import { pub } from "../../orpc";
import * as service from "./service";

const list = pub
  .input(service.listBlockDefinitionsInput)
  .handler(({ context, input }) => runService(service.listBlockDefinitions(context, input)));

const sync = pub
  .input(service.syncBlockDefinitionsInput)
  .handler(({ context, input }) => runService(service.syncBlockDefinitions(context, input)));

const upsert = pub
  .input(service.upsertBlockDefinitionInput)
  .handler(({ context, input }) => runService(service.upsertBlockDefinition(context, input)));

const deleteFn = pub
  .input(service.deleteBlockDefinitionInput)
  .handler(({ context, input }) => runService(service.deleteBlockDefinition(context, input)));

export const blockDefinitionProcedures = { list, sync, upsert, delete: deleteFn };
