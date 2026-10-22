import { message } from "@optique/core/message";
import { optional } from "@optique/core/modifiers";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";

export const cwdFlag = optional(
  option("--cwd", string({ metavar: "PATH" }), {
    description: message`Start runtime lookup in this directory and walk upward. Relative to the shell's current directory; does not change how other file paths resolve.`,
  }),
);

/** The project a command targets, overriding the one in the runtime sidecar. */
export const projectFlag = optional(
  option("--project", string({ metavar: "PROJECT" }), {
    description: message`Target this project, by its Project ID or its Project Slug. Takes precedence over CAMOX_PROJECT. Defaults to the project of the app found by the runtime lookup.`,
  }),
);

/** The locale a content command reads or writes (ADR 0015). */
export const localeFlag = optional(
  option("--locale", string({ metavar: "TAG" }), {
    description: message`Read or write content in this locale, by its BCP 47 tag, such as de. Defaults to the default locale. List locales with locales list.`,
  }),
);
