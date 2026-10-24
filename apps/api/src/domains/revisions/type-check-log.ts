import { LOG_TAIL_LINES } from "./build-log";
import type { TypeCheckError } from "./result";

// What tsrs prints with `--pretty false`, as TypeScript's compiler does: one error per line,
// `file(line,column): error TS1234: message`, the message's later lines indented under it, and
// errors about no file, such as a missing type library, as `error TS1234: message`.
const LOCATED = /^(.+?)\((\d+),\d+\): error (TS\d+): (.*)$/;
const UNLOCATED = /^error (TS\d+): (.*)$/;

/**
 * The errors of a type check that failed, from what it printed. Output without a readable error
 * comes back as one error holding its tail, with no file.
 */
export function typeErrorsOf(output: string): TypeCheckError[] {
  const errors: TypeCheckError[] = [];
  for (const line of output.split("\n")) {
    const located = LOCATED.exec(line);
    const unlocated = located ? null : UNLOCATED.exec(line);
    if (located) {
      const [, file, at, code, message] = located;
      errors.push({ file: file!, line: Number(at), code: code!, message: message! });
    } else if (unlocated) {
      errors.push({ file: "", line: 0, code: unlocated[1]!, message: unlocated[2]! });
    } else if (/^\s+\S/.test(line) && errors.length > 0) {
      errors.at(-1)!.message += `\n${line.replace(/^ {2}/, "").trimEnd()}`;
    }
  }
  if (errors.length > 0) return errors;
  const tail = output.trimEnd().split("\n").slice(-LOG_TAIL_LINES).join("\n");
  return [{ file: "", line: 0, code: "", message: tail }];
}
