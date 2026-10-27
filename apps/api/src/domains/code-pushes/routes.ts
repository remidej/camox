import { runService } from "../../lib/run-service";
import { authed } from "../../orpc";
import * as service from "./service";

const push = authed
  .input(service.pushInput)
  .handler(({ context, input }) => runService(service.pushToDraft(context, input)));

export const codeProcedures = { push };
