import { agentProcedures } from "./domains/agent/routes";
import { blockDefinitionProcedures } from "./domains/block-definitions/routes";
import { blockProcedures } from "./domains/blocks/routes";
import { commentProcedures } from "./domains/comments/routes";
import { environmentProcedures } from "./domains/environments/routes";
import { fileProcedures } from "./domains/files/routes";
import { layoutProcedures } from "./domains/layouts/routes";
import { pageProcedures } from "./domains/pages/routes";
import { projectProcedures } from "./domains/projects/routes";
import { repeatableItemProcedures } from "./domains/repeatable-items/routes";

export const router = {
  projects: projectProcedures,
  pages: pageProcedures,
  blocks: blockProcedures,
  comments: commentProcedures,
  layouts: layoutProcedures,
  files: fileProcedures,
  repeatableItems: repeatableItemProcedures,
  blockDefinitions: blockDefinitionProcedures,
  environments: environmentProcedures,
  agent: agentProcedures,
};

export type Router = typeof router;
