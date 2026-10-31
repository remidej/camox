import { runService } from "../../lib/run-service";
import { pub } from "../../orpc";
import * as service from "./service";

// Public procedures

const get = pub
  .input(service.getLayoutInput)
  .handler(({ context, input }) => runService(service.getLayout(context, input)));

/** A curated Layout around no page, its blocks with overrides: what the agent's `look` shows. */
const getUnplaced = pub
  .input(service.getUnplacedLayoutInput)
  .handler(({ context, input }) => runService(service.getUnplacedLayout(context, input)));

const list = pub
  .input(service.listLayoutsInput)
  .handler(({ context, input }) => runService(service.listLayouts(context, input)));

export const layoutProcedures = {
  get,
  getUnplaced,
  list,
};
