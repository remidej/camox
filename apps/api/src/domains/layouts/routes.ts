import { authed, pub } from "../../orpc";
import * as service from "./service";

// Public procedures

const get = pub
  .input(service.getLayoutInput)
  .handler(({ context, input }) => service.getLayout(context, input));

const list = pub
  .input(service.listLayoutsInput)
  .handler(({ context, input }) => service.listLayouts(context, input));

const sync = pub
  .input(service.syncLayoutsInput)
  .handler(({ context, input }) => service.syncLayouts(context, input));

// Protected procedures

const publish = authed
  .input(service.publishLayoutInput)
  .handler(({ context, input }) => service.publishLayout(context, input));

const unpublish = authed
  .input(service.unpublishLayoutInput)
  .handler(({ context, input }) => service.unpublishLayout(context, input));

export const layoutProcedures = { get, list, sync, publish, unpublish };
