import { agentProcedures } from "./domains/agent/routes";
import { blockDefinitionProcedures } from "./domains/block-definitions/routes";
import { blockProcedures } from "./domains/blocks/routes";
import { codeProcedures } from "./domains/code-pushes/routes";
import { collectionDefinitionProcedures } from "./domains/collections/routes";
import { definitionProcedures } from "./domains/definitions/routes";
import { draftProcedures } from "./domains/drafts/routes";
import { fileProcedures } from "./domains/files/routes";
import { layoutProcedures } from "./domains/layouts/routes";
import { localeProcedures } from "./domains/locales/routes";
import { pageProcedures } from "./domains/pages/routes";
import { patrolProcedures } from "./domains/patrol/routes";
import { projectProcedures } from "./domains/projects/routes";
import { repeatableItemProcedures } from "./domains/repeatable-items/routes";

export const router = {
  projects: projectProcedures,
  pages: pageProcedures,
  blocks: blockProcedures,
  layouts: layoutProcedures,
  locales: localeProcedures,
  files: fileProcedures,
  repeatableItems: repeatableItemProcedures,
  blockDefinitions: blockDefinitionProcedures,
  collectionDefinitions: collectionDefinitionProcedures,
  definitions: definitionProcedures,
  drafts: draftProcedures,
  agent: agentProcedures,
  patrol: patrolProcedures,
  code: codeProcedures,
};

export type Router = typeof router;
