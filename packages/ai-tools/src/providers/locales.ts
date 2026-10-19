import { z } from "zod";

import {
  addBackToLocale,
  addBackToLocaleInput,
  listMissingFromLocale,
} from "../../../../apps/api/src/domains/locales/missing";
import {
  addLocale,
  addLocaleInput,
  listLocales,
  removeLocale,
  removeLocaleInput,
  setDefaultLocaleTag,
  setDefaultLocaleTagInput,
} from "../../../../apps/api/src/domains/locales/service";
import { runService } from "../../../../apps/api/src/lib/run-service";
import type { ToolDefinition, ToolProvider } from "../types";

// Locales are content (ADR 0015): adding and removing one changes the session's draft, and
// publishing the draft puts the change on Live.

const listInput = z.object({});
const addInput = addLocaleInput.omit({ projectId: true });
const removeInput = removeLocaleInput.omit({ projectId: true });
const setDefaultTagInput = setDefaultLocaleTagInput.omit({ projectId: true });
const listMissingInput = z.object({});
const addBackInput = addBackToLocaleInput.omit({ projectId: true });

export const localesProvider: ToolProvider = (ctx): ToolDefinition[] => [
  {
    name: "listLocales",
    description:
      "List the draft's locales, each with its BCP 47 `tag` and whether it's the default locale, " +
      "the default first. Every other locale's content is a localization of the default " +
      "locale's: pass a locale's tag as `locale` to the content tools to read or write it.",
    inputSchema: listInput,
    meta: { kind: "read", risk: "safe", surfaces: ["cli"] },
    handler: async () => runService(listLocales(ctx, { projectId: ctx.projectId })),
  },
  {
    name: "addLocale",
    description:
      "Add a locale to the draft, by any BCP 47 tag such as `de`, `pt-BR` or `fr-CA`. Every " +
      "page, block, repeatable item, synced block's shared content and collection record of the " +
      "default locale gets a localization in it, keeping its original's id, which Camox " +
      "translates in the background. Every later change to the default locale in the draft is " +
      "translated into it too; changes to a localization aren't translated anywhere. " +
      "Publishing the draft puts the locale on Live. A locale whose prefix (its tag in lowercase) " +
      "is a top-level page path in the default locale blocks publishing.",
    inputSchema: addInput,
    meta: { kind: "write", risk: "safe", surfaces: ["cli"] },
    handler: async (input) =>
      runService(addLocale(ctx, { ...addInput.parse(input), projectId: ctx.projectId })),
  },
  {
    name: "removeLocale",
    description:
      "Remove a locale from the draft, with all of its content. Publishing the draft deletes the " +
      "locale and its content from Live for good. The default locale can't be removed. Only " +
      "remove a locale when the user asks to.",
    inputSchema: removeInput,
    meta: { kind: "write", risk: "requiresApproval", surfaces: ["cli"] },
    handler: async (input) =>
      runService(removeLocale(ctx, { ...removeInput.parse(input), projectId: ctx.projectId })),
  },
  {
    name: "listMissingFromLocale",
    description:
      "List the pages and collection records deleted from a locale, which Camox no longer " +
      "translates into it: `pages` with their `id`, `fullPath` and `nickname`, `records` with " +
      "their `id`, `collectionId` and `label`, as the default locale shows them. A page deleted " +
      "beneath another deleted page isn't listed: adding back the page above brings it back. " +
      "The default locale misses nothing.",
    inputSchema: listMissingInput,
    meta: { kind: "read", risk: "safe", surfaces: ["cli"], localized: true },
    handler: async () => runService(listMissingFromLocale(ctx, { projectId: ctx.projectId })),
  },
  {
    name: "addBackToLocale",
    description:
      "Add a page or collection record deleted from a locale back to it, with everything beneath " +
      "it, in the draft. Camox translates it from the default locale again in the background, " +
      "and keeps translating its changes. Pages and records deleted from the locale on their " +
      "own stay deleted. listMissingFromLocale lists what can be added back.",
    inputSchema: addBackInput,
    meta: { kind: "write", risk: "safe", surfaces: ["cli"], localized: true },
    handler: async (input) =>
      runService(addBackToLocale(ctx, { ...addBackInput.parse(input), projectId: ctx.projectId })),
  },
  {
    name: "setDefaultLocaleTag",
    description:
      "Correct the default locale's BCP 47 tag, such as from `en` to `en-GB`. This is only " +
      "possible while the default locale is the project's only locale, and it applies at once, " +
      "on Live and in every draft, since no content changes.",
    inputSchema: setDefaultTagInput,
    meta: { kind: "write", risk: "requiresApproval", surfaces: ["cli"] },
    handler: async (input) =>
      runService(
        setDefaultLocaleTag(ctx, { ...setDefaultTagInput.parse(input), projectId: ctx.projectId }),
      ),
  },
];
