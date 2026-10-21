import { runService } from "../../lib/run-service";
import { pub } from "../../orpc";
import * as service from "./service";

// Public procedures

const get = pub
  .input(service.getLayoutInput)
  .handler(({ context, input }) => runService(service.getLayout(context, input)));

const list = pub
  .input(service.listLayoutsInput)
  .handler(({ context, input }) => runService(service.listLayouts(context, input)));

export const layoutProcedures = {
  get,
  list,
};
