import { runService } from "../../lib/run-service";
import { authed, pub } from "../../orpc";
import { projectOfSlug, inScope } from "../blocks/draft-scope";
import * as service from "./service";

// Public procedures

// A page's blocks are read in the request's draft; the page itself is Live's until #238.
const getByPath = pub
  .input(service.getPageByPathInput)
  .handler(({ context, input }) =>
    inScope(context, projectOfSlug(context, input.projectSlug), (scope) =>
      service.getPageByPath(context, input, scope),
    ),
  );

const getStructure = pub
  .input(service.getPageStructureInput)
  .handler(({ context, input }) =>
    inScope(context, projectOfSlug(context, input.projectSlug), (scope) =>
      service.getPageStructure(context, input, scope),
    ),
  );

const list = pub
  .input(service.listPagesInput)
  .handler(({ context, input }) => runService(service.listPages(context, input)));

const listBySlug = pub
  .input(service.listPagesBySlugInput)
  .handler(({ context, input }) => runService(service.listPagesBySlug(context, input)));

const get = pub
  .input(service.getPageInput)
  .handler(({ context, input }) => runService(service.getPage(context, input)));

// Protected procedures

const create = authed
  .input(service.createPageInput)
  .handler(({ context, input }) => runService(service.createPage(context, input)));

const update = authed
  .input(service.updatePageInput)
  .handler(({ context, input }) => runService(service.updatePage(context, input)));

const deleteFn = authed
  .input(service.deletePageInput)
  .handler(({ context, input }) => runService(service.deletePage(context, input)));

const setAiSeo = authed
  .input(service.setPageAiSeoInput)
  .handler(({ context, input }) => runService(service.setPageAiSeo(context, input)));

const setMetaTitle = authed
  .input(service.setPageMetaTitleInput)
  .handler(({ context, input }) => runService(service.setPageMetaTitle(context, input)));

const setMetaDescription = authed
  .input(service.setPageMetaDescriptionInput)
  .handler(({ context, input }) => runService(service.setPageMetaDescription(context, input)));

const setLayout = authed
  .input(service.setPageLayoutInput)
  .handler(({ context, input }) => runService(service.setPageLayout(context, input)));

const generateSeo = authed
  .input(service.generatePageSeoInput)
  .handler(({ context, input }) => runService(service.generatePageSeo(context, input)));

export const pageProcedures = {
  getByPath,
  getStructure,
  list,
  listBySlug,
  get,
  create,
  update,
  delete: deleteFn,
  setAiSeo,
  setMetaTitle,
  setMetaDescription,
  setLayout,
  generateSeo,
};
