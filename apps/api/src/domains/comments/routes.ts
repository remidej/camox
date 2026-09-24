import { authed } from "../../orpc";
import * as service from "./service";

export const commentProcedures = {
  list: authed
    .input(service.listCommentsInput)
    .handler(({ context, input }) => service.listComments(context, input)),
  create: authed
    .input(service.createCommentInput)
    .handler(({ context, input }) => service.createComment(context, input)),
  setResolved: authed
    .input(service.setCommentResolvedInput)
    .handler(({ context, input }) => service.setCommentResolved(context, input)),
};
