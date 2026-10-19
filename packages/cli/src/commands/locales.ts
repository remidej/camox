import { object, or } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { optional } from "@optique/core/modifiers";
import { command, constant, option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";

import { dispatch } from "../lib/dispatch";
import type { OutputMode } from "../lib/output";
import { cwdFlag } from "../lib/runtime-options";

// Locales are content (ADR 0015): adding and removing one changes the development draft, and
// publishing it puts the change on Live.

const projectFlag = optional(option("--project", string({ metavar: "SLUG" })));
const jsonFlag = option("--json");
const tagFlag = option("--tag", string({ metavar: "TAG" }), {
  description: message`A BCP 47 language tag, such as de, pt-BR or fr-CA.`,
});

const list = command(
  "list",
  object({
    command: constant("locales.list" as const),
    cwd: cwdFlag,
    project: projectFlag,
    json: jsonFlag,
  }),
  {
    description: message`List the draft's locales, the default locale first. Pass a locale's tag to --locale on pages, blocks and layouts commands to read or write its content.`,
  },
);

const add = command(
  "add",
  object({
    command: constant("locales.add" as const),
    tag: tagFlag,
    cwd: cwdFlag,
    project: projectFlag,
    json: jsonFlag,
  }),
  {
    description: message`Add a locale. Every page, block, repeatable item, synced block and collection record of the default locale gets an untranslated copy in it, keeping its id. Publishing puts the locale on Live. Example: camox locales add --tag de.`,
  },
);

const remove = command(
  "remove",
  object({
    command: constant("locales.remove" as const),
    tag: tagFlag,
    cwd: cwdFlag,
    project: projectFlag,
    json: jsonFlag,
  }),
  {
    description: message`Remove a locale with all of its content. Publishing deletes them from Live for good. The default locale can't be removed.`,
  },
);

const setDefaultTag = command(
  "set-default-tag",
  object({
    command: constant("locales.set-default-tag" as const),
    tag: tagFlag,
    cwd: cwdFlag,
    project: projectFlag,
    json: jsonFlag,
  }),
  {
    description: message`Correct the default locale's tag, such as from en to en-GB, on Live and in every draft at once. Only possible while it's the only locale.`,
  },
);

export const parser = command("locales", or(list, add, remove, setDefaultTag));

type CommonFlags = { cwd?: string; project?: string; json: boolean };

type Args =
  | ({ command: "locales.list" } & CommonFlags)
  | ({ command: "locales.add"; tag: string } & CommonFlags)
  | ({ command: "locales.remove"; tag: string } & CommonFlags)
  | ({ command: "locales.set-default-tag"; tag: string } & CommonFlags);

const TOOLS = {
  "locales.list": "listLocales",
  "locales.add": "addLocale",
  "locales.remove": "removeLocale",
  "locales.set-default-tag": "setDefaultLocaleTag",
} as const;

export async function handler(args: Args): Promise<never> {
  const outputMode: OutputMode = args.json ? "json" : "auto";
  return dispatch({
    toolName: TOOLS[args.command],
    args: "tag" in args ? { tag: args.tag } : {},
    cwd: args.cwd,
    projectFlag: args.project,
    outputMode,
  });
}
