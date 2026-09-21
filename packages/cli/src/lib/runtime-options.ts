import { message } from "@optique/core/message";
import { optional } from "@optique/core/modifiers";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";

export const cwdFlag = optional(
  option("--cwd", string({ metavar: "PATH" }), {
    description: message`Start runtime lookup in this directory and walk upward. Relative to the shell's current directory; does not change how other file paths resolve.`,
  }),
);
