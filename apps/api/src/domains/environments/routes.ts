import { runService } from "../../lib/run-service";
import { authed } from "../../orpc";
import * as service from "./service";

// Protected procedures

const checkCompatibility = authed
  .input(service.checkCompatibilityInput)
  .handler(({ context, input }) => runService(service.checkCompatibility(context, input)));

const replicate = authed
  .input(service.replicateEnvironmentInput)
  .handler(({ context, input }) => runService(service.replicateEnvironment(context, input)));

export const environmentProcedures = {
  checkCompatibility,
  replicate,
};
