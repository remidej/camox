import { runService } from "../../lib/run-service";
import { authed } from "../../orpc";
import * as service from "./service";

const callTool = authed
  .input(service.callToolInput)
  .handler(({ context, input }) => runService(service.callTool(context, input)));

const listTools = authed
  .input(service.listToolsInput)
  .handler(({ context, input }) => runService(service.listTools(context, input)));

export const agentProcedures = {
  callTool,
  listTools,
};
