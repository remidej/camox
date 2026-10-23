import { runService } from "../../lib/run-service";
import { authed, contentWrite, pub } from "../../orpc";
import * as service from "./service";

// Every procedure reads and writes pages in the draft the request names (ADR 0011).

// Public procedures

const getByPath = pub
  .input(service.getPageByPathInput)
  .handler(({ context, input }) => runService(service.getPageByPath(context, input)));

const getStructure = pub
  .input(service.getPageStructureInput)
  .handler(({ context, input }) => runService(service.getPageStructure(context, input)));

const getMarkdown = pub
  .input(service.getPageMarkdownAtInput)
  .handler(({ context, input }) => runService(service.getPageMarkdownAt(context, input)));

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

const create = contentWrite
  .input(service.createPageInput)
  .handler(({ context, input }) => runService(service.createPage(context, input)));

const update = contentWrite
  .input(service.updatePageInput)
  .handler(({ context, input }) => runService(service.updatePage(context, input)));

const deleteFn = contentWrite
  .input(service.deletePageInput)
  .handler(({ context, input }) => runService(service.deletePage(context, input)));

const setSeo = contentWrite
  .input(service.setPageSeoInput)
  .handler(({ context, input }) => runService(service.setPageSeo(context, input)));

const setLayout = contentWrite
  .input(service.setPageLayoutInput)
  .handler(({ context, input }) => runService(service.setPageLayout(context, input)));

const generateSeo = authed
  .input(service.generatePageSeoInput)
  .handler(({ context, input }) => runService(service.generatePageSeo(context, input)));

export const pageProcedures = {
  getByPath,
  getStructure,
  getMarkdown,
  list,
  listBySlug,
  get,
  create,
  update,
  delete: deleteFn,
  setSeo,
  setLayout,
  generateSeo,
};
