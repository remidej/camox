import { runService } from "../../lib/run-service";
import { authed, pub } from "../../orpc";
import { referenceTargets, referenceTargetsInput } from "../collections/reference-publication";
import * as service from "./service";

// Public procedures

const get = pub
  .input(service.getLayoutInput)
  .handler(({ context, input }) => runService(service.getLayout(context, input)));

const list = pub
  .input(service.listLayoutsInput)
  .handler(({ context, input }) => runService(service.listLayouts(context, input)));

const sync = pub
  .input(service.syncLayoutsInput)
  .handler(({ context, input }) => runService(service.syncLayouts(context, input)));

// Protected procedures

const publish = authed
  .input(service.publishLayoutInput)
  .handler(({ context, input }) => runService(service.publishLayout(context, input)));

const unpublish = authed
  .input(service.unpublishLayoutInput)
  .handler(({ context, input }) => runService(service.unpublishLayout(context, input)));

export const layoutProcedures = {
  get,
  list,
  sync,
  publish,
  unpublish,
  referenceTargets: authed
    .input(referenceTargetsInput)
    .handler(({ context, input }) => runService(referenceTargets(context, input, "layout"))),
};
