import type { BuildError } from "./result";

// Reads the errors out of a failed `vp build`'s log. Rolldown prints each error after a
// `Build failed with N errors:` line, starting with a tag in brackets:
//
//   [UNRESOLVED_IMPORT] Could not resolve './missing' in src/lib/a.ts
//      ╭─[ src/lib/a.ts:1:19 ]
//      │
//    1 │ import { y } from "./missing";
//      │                   ─────┬─────
//      │                        ╰─────── Module not found.
//   ───╯
//
// A plugin's error names the plugin, then its message and stack on the lines after:
//
//   [plugin camox]
//   RolldownError: src/blocks/hero.tsx imports "node:fs", which a hosted project can't import. …
//       at error (file:///…)
//
// or, for an error at a place in a file, that place after the plugin, and its code frame:
//
//   [plugin camox] /workspace/website/src/blocks/faq.tsx:5:6
//   RolldownError: src/blocks/faq.tsx defines the block "questions", but its file is named …
//   5:   id: "questions",
//            ^

/** Terminal colors, which Rolldown prints even when it isn't writing to a terminal. */
// oxlint-disable-next-line no-control-regex
const COLORS = /\u001b\[[0-9;]*m/g;
const SUMMARY = /^(?:error during build:\s*)?Build failed with \d+ errors?:\s*$/m;
const TAG = /^\[([^\]\n]+)\] ?(.*)$/;
const LOCATION = /╭─\[\s*(.+?):(\d+):(\d+)\s*\]/;
const STACK = /^\s+at /;
/** The place a plugin's error is at, after the plugin's tag. */
const PLACE = /^(\S+):(\d+):(\d+)$/;
/** A message starting with the file it's about, as Camox's own build checks' do. */
const LEADING_FILE = /^((?:src|public)\/\S+\.\w+)\s/;

/** A path from the website's root, as the agent's tools name it. */
function fromRoot(path: string) {
  const inSource = /(?:^|\/)((?:src|public)\/.+)$/.exec(path);
  return inSource ? inSource[1]! : path.replace(/^(?:\.\.\/)+/, "");
}

/** One error's block of lines, from its tag to the next. */
function errorOf(lines: string[]): BuildError {
  const [, tag, rest] = TAG.exec(lines[0]!)!;
  const body = lines.slice(1).filter((line) => !STACK.test(line));
  const place = PLACE.exec(rest ?? "");
  if (place) {
    const message = (body.shift() ?? "").replace(/^[A-Za-z]*Error: /, "").trim() || tag!;
    return {
      file: fromRoot(place[1]!),
      line: Number(place[2]),
      column: Number(place[3]),
      message,
      frame: body.join("\n").trimEnd(),
    };
  }
  // A plugin's error has its message on the next line, after the error's name.
  const message = (rest || (body.shift() ?? "").replace(/^[A-Za-z]*Error: /, "") || tag!).trim();
  const frameStart = body.findIndex((line) => LOCATION.test(line));
  const frameEnd = body.findIndex((line, at) => at > frameStart && /^\s*─+╯/.test(line));
  const frame =
    frameStart === -1
      ? ""
      : body.slice(frameStart, frameEnd === -1 ? undefined : frameEnd + 1).join("\n");
  const location = LOCATION.exec(frame);
  if (location) {
    return {
      file: fromRoot(location[1]!),
      line: Number(location[2]),
      column: Number(location[3]),
      message,
      frame,
    };
  }
  const leading = LEADING_FILE.exec(message);
  return { file: leading ? leading[1]! : "", line: 0, column: 0, message, frame };
}

/** The last lines of a log, as an error it couldn't read is given back. */
export const LOG_TAIL_LINES = 40;

/**
 * The errors a failed build's log reports. A log they can't be read from gives one error with no
 * file, whose message is the log's tail.
 */
export function buildErrorsOf(log: string): BuildError[] {
  const text = log.replace(COLORS, "").replaceAll("\r\n", "\n");
  const summary = SUMMARY.exec(text);
  const errors: BuildError[] = [];
  if (summary) {
    let block: string[] | undefined;
    for (const line of text.slice(summary.index + summary[0].length).split("\n")) {
      if (TAG.test(line)) {
        if (block) errors.push(errorOf(block));
        block = [line];
      } else block?.push(line);
    }
    if (block) errors.push(errorOf(block));
  }
  if (errors.some(({ file }) => file)) return errors;
  const tail = text.trimEnd().split("\n").slice(-LOG_TAIL_LINES).join("\n");
  return [{ file: "", line: 0, column: 0, message: tail, frame: "" }];
}
