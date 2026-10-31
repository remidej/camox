import type { MergeClash } from "../../durable-objects/draft-code";

// Camox's reconcile turn (ADR 0020's amendment, spec #560 section 11): when merging Live's code
// into a draft clashes, Camox starts a turn of its own in the draft's thread, which only
// reconciles code. It tries once for each move of `main`: editors are never asked about code. The
// turn opens in the thread's agent's conversation, which hands the clash to the Code Agent, where
// code is written (ADR 0037).

/** What a reconcile turn starts with: the short message editors see, and the agent's instructions. */
export type ReconcileTurn = { message: string; instructions: string };

const RULES =
  "This request is Camox's own, not an editor's: reconcile the code, and change nothing else. " +
  "Where both versions can't be kept, keep what this draft's version does, and say so. Build " +
  "when you're done: the revision it commits is the merge of Live's code. Your answer is shown " +
  "to the draft's editors: say in a sentence or two what changed, in terms of what they see in " +
  "the preview rather than code.";

/**
 * The thread's agent's instructions for a reconcile turn: hand `request` to the Code Agent, and
 * end the turn on its answer.
 */
const handedToTheCodeAgent = (request: string) =>
  "This turn is Camox's own, not an editor's: Live's code clashes with this draft's. Change " +
  "nothing yourself, content included. Call `code` once, with `final`, and this request as it " +
  `is, between the lines:\n\n---\n${request}\n---`;

/** The reconcile turn for the merge of `main` that clashed as `clash`. */
export function reconcileTurn(clash: MergeClash): ReconcileTurn {
  if (clash.conflicts) {
    const files = clash.conflicts.length > 0 ? `: ${clash.conflicts.join(", ")}` : "";
    return {
      message:
        "Live's code changed since this draft started, in ways that clash with the draft's " +
        "code changes. I'm reconciling them, keeping what this draft does.",
      instructions: handedToTheCodeAgent(
        "Live's code changed, from another publish or an Upgrade, and merging it into this " +
          `draft's code conflicts in some files${files}. They hold both versions between conflict ` +
          "markers: `<<<<<<< draft`, the draft's, then `=======`, then Live's, until " +
          "`>>>>>>> Live`. Call `conflicts` to list the files that still have markers, read them, " +
          "and edit each conflict into code that does what both versions do. `build` refuses to " +
          `commit while any file has markers. ${RULES}`,
      ),
    };
  }
  const types = (clash.result?.types.length ?? 0) > 0 && clash.result?.build.length === 0;
  return {
    message:
      "Live's code changed since this draft started, and together with the draft's code " +
      `changes it no longer ${types ? "type checks" : "builds"}. I'm fixing it, keeping what ` +
      "this draft does.",
    instructions: handedToTheCodeAgent(
      "Live's code changed, from another publish or an Upgrade. It merges into this draft's " +
        `code without conflicts, but the merged code doesn't ${types ? "type check" : "build"}: ` +
        `the files hold it now. Fix these errors. ${RULES}\n\n${JSON.stringify(clash.result)}`,
    ),
  };
}
