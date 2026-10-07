import { runService } from "../../lib/run-service";
import { authed } from "../../orpc";
import * as service from "./service";

export const commentProcedures = {
  list: authed
    .input(service.listCommentsInput)
    .handler(({ context, input }) => runService(service.listComments(context, input))),
  create: authed
    .input(service.createCommentInput)
    .handler(({ context, input }) => runService(service.createComment(context, input))),
  setResolved: authed
    .input(service.setCommentResolvedInput)
    .handler(({ context, input }) => runService(service.setCommentResolved(context, input))),
};
