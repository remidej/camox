import { runService } from "../../lib/run-service";
import { pub } from "../../orpc";
import { projectOfSlug, inScope } from "../blocks/draft-scope";
import * as service from "./service";

// Public procedures

const get = pub
  .input(service.getLayoutInput)
  .handler(({ context, input }) =>
    inScope(context, projectOfSlug(context, input.projectSlug), (scope) =>
      service.getLayout(context, input, scope),
    ),
  );

const list = pub
  .input(service.listLayoutsInput)
  .handler(({ context, input }) => runService(service.listLayouts(context, input)));

const sync = pub
  .input(service.syncLayoutsInput)
  .handler(({ context, input }) => runService(service.syncLayouts(context, input)));

export const layoutProcedures = {
  get,
  list,
  sync,
};
