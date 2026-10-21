import { runService } from "../../lib/run-service";
import { pub } from "../../orpc";
import * as service from "./service";

const list = pub
  .input(service.listBlockDefinitionsInput)
  .handler(({ context, input }) => runService(service.listBlockDefinitions(context, input)));

export const blockDefinitionProcedures = { list };
