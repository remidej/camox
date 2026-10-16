import { uuidv7Schema } from "@camox/api-contract/ids";
import { message } from "@optique/core/message";
import type { ValueParser } from "@optique/core/valueparser";

/** An entity id option: rejects anything that isn't a UUIDv7 before any request. */
export function uuidv7(): ValueParser<"sync", string> {
  return {
    mode: "sync",
    metavar: "ID",
    placeholder: "",
    parse(input) {
      if (uuidv7Schema.safeParse(input).success) return { success: true, value: input };
      return { success: false, error: message`Expected a UUIDv7, but got ${input}.` };
    },
    format: (value) => value,
  };
}
