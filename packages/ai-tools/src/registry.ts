import { blockTypesProvider } from "./providers/block-types";
import { blocksProvider } from "./providers/blocks";
import { collectionsProvider } from "./providers/collections";
import { commentsProvider } from "./providers/comments";
import { environmentsProvider } from "./providers/environments";
import { filesProvider } from "./providers/files";
import { layoutsProvider } from "./providers/layouts";
import { pagesProvider } from "./providers/pages";
import type { ToolProvider } from "./types";

export const toolProviders: ToolProvider[] = [
  pagesProvider,
  layoutsProvider,
  blockTypesProvider,
  blocksProvider,
  commentsProvider,
  collectionsProvider,
  environmentsProvider,
  filesProvider,
];
