import { authed, pub } from "../../orpc";
import { inScope, projectOfPage, projectOfSlug } from "../blocks/draft-scope";
import * as service from "./service";

// Every procedure reads and writes pages in the draft the request names (ADR 0011).

// Public procedures

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
  .handler(({ context, input }) =>
    inScope(context, input.projectId, (scope) => service.listPages(context, input, scope)),
  );

const listBySlug = pub
  .input(service.listPagesBySlugInput)
  .handler(({ context, input }) =>
    inScope(context, projectOfSlug(context, input.projectSlug), (scope) =>
      service.listPagesBySlug(context, input, scope),
    ),
  );

const get = pub
  .input(service.getPageInput)
  .handler(({ context, input }) =>
    inScope(context, "id" in input ? projectOfPage(context, input.id) : input.projectId, (scope) =>
      service.getPage(context, input, scope),
    ),
  );

// Protected procedures

const create = authed
  .input(service.createPageInput)
  .handler(({ context, input }) =>
    inScope(context, input.projectId, (scope) => service.createPage(context, input, scope)),
  );

const update = authed
  .input(service.updatePageInput)
  .handler(({ context, input }) =>
    inScope(context, projectOfPage(context, input.id), (scope) =>
      service.updatePage(context, input, scope),
    ),
  );

const deleteFn = authed
  .input(service.deletePageInput)
  .handler(({ context, input }) =>
    inScope(context, projectOfPage(context, input.id), (scope) =>
      service.deletePage(context, input, scope),
    ),
  );

const setAiSeo = authed
  .input(service.setPageAiSeoInput)
  .handler(({ context, input }) =>
    inScope(context, projectOfPage(context, input.id), (scope) =>
      service.setPageAiSeo(context, input, scope),
    ),
  );

const setMetaTitle = authed
  .input(service.setPageMetaTitleInput)
  .handler(({ context, input }) =>
    inScope(context, projectOfPage(context, input.id), (scope) =>
      service.setPageMetaTitle(context, input, scope),
    ),
  );

const setMetaDescription = authed
  .input(service.setPageMetaDescriptionInput)
  .handler(({ context, input }) =>
    inScope(context, projectOfPage(context, input.id), (scope) =>
      service.setPageMetaDescription(context, input, scope),
    ),
  );

const setLayout = authed
  .input(service.setPageLayoutInput)
  .handler(({ context, input }) =>
    inScope(context, projectOfPage(context, input.id), (scope) =>
      service.setPageLayout(context, input, scope),
    ),
  );

const generateSeo = authed
  .input(service.generatePageSeoInput)
  .handler(({ context, input }) =>
    inScope(context, projectOfPage(context, input.id), (scope) =>
      service.generatePageSeo(context, input, scope),
    ),
  );

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
