import { blockTypesProvider } from "./providers/block-types";
import { blocksProvider } from "./providers/blocks";
import { collectionsProvider } from "./providers/collections";
import { draftsProvider } from "./providers/drafts";
import { filesProvider } from "./providers/files";
import { findingsProvider } from "./providers/findings";
import { layoutsProvider } from "./providers/layouts";
import { localesProvider } from "./providers/locales";
import { pagesProvider } from "./providers/pages";
import type { ToolProvider } from "./types";

export const toolProviders: ToolProvider[] = [
  pagesProvider,
  layoutsProvider,
  localesProvider,
  blockTypesProvider,
  blocksProvider,
  collectionsProvider,
  filesProvider,
  draftsProvider,
  findingsProvider,
];
