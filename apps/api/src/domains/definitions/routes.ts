import { runService } from "../../lib/run-service";
import { pub } from "../../orpc";
import * as service from "./service";

// A release, with the deploy token: the service checks.
const sync = pub
  .input(service.syncDefinitionsInput)
  .handler(({ context, input }) => runService(service.syncDefinitions(context, input)));

export const definitionProcedures = { sync };
