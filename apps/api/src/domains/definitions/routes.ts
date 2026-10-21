import { runService } from "../../lib/run-service";
import { pub } from "../../orpc";
import * as service from "./service";

// A release with the deploy token, or dev mode with a member's session: the service checks.
const sync = pub
  .input(service.syncDefinitionsInput)
  .handler(({ context, input }) => runService(service.syncDefinitions(context, input)));

export const definitionProcedures = { sync };
