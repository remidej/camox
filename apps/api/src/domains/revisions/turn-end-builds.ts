import type { BuildStatus } from "@camox/api-contract/threads";
import { type HookApi, LiveDoc, ROOT_CONVERSATION_ID } from "@earendil-works/pi-durable";

import type { Bindings } from "../../types";
import type { ToolInvocation } from "../threads/tools";
import {
  buildAtEndOfTurn,
  END_OF_TURN_BUILD_FAILURES,
  explainFailures,
  fixBuild,
  fixLint,
  type TurnBuild,
} from "./end-of-turn";
import type { BuildResult } from "./result";

/** Where a tool call, or a hook, runs: the conversation, as Pi reads it then. */
export type InConversation = {
  api: Pick<HookApi, "snapshot" | "conversationId">;
  context: ToolInvocation["context"];
};

/**
 * The prefix of the keys recording that a turn changed code, followed by its turn (`turnOf`):
 * the end of such a turn builds and lints, so an Artifact Agent's answer can't end it.
 */
const TURN_WROTE_CODE_PREFIX = "camox.turn-wrote-code:";

/** The prefix of the keys counting a turn's end-of-turn builds that failed in a row, as above. */
const TURN_BUILD_FAILURES_PREFIX = "camox.turn-build-failures:";

/**
 * The prefix of the keys holding the commit a turn's draft code was at as it first wrote code, as
 * above: the end of its turn lints the files changed since.
 */
const TURN_BASE_PREFIX = "camox.turn-base:";

/**
 * The turn going in the conversation of `invocation`, which names it for as long as it goes:
 * its run's first input, after the conversation's id beside the root, whose inputs are numbered
 * apart. None outside a run.
 */
export async function turnOf({ api, context }: InConversation): Promise<string | undefined> {
  const live = await api.snapshot(LiveDoc, api.conversationId, context);
  const input = live?.run?.inputs[0];
  if (input === undefined) return undefined;
  return api.conversationId === ROOT_CONVERSATION_ID
    ? String(input)
    : `${api.conversationId}:${String(input)}`;
}

/** What the end-of-turn builds need of the thread they run in. */
export type TurnEndThread = {
  env: Bindings;
  storage: DurableObjectStorage;
  threadId: () => string;
  /** The thread's draft, when it has code. */
  draftWithCode: () => Promise<string | null>;
  /** Runs `build` in the draft's build queue, the draft showing it's building. */
  buildingSerially: <T>(draftId: string, build: () => Promise<T>) => Promise<T>;
  /** Records in the transcript where the end of the turn's build stands, for editors to see. */
  showBuildStatus: (status: BuildStatus) => Promise<void>;
  /** Merges the `main` that moved during the turn ending. */
  mergeAfterTheTurn: (draftId: string) => Promise<void>;
  /** Counts a revision a build in the turn going left, for its timing logs. */
  timeTurnRevision: (
    result: BuildResult,
    ids: { draftId: string; runId?: string },
  ) => Promise<void>;
};

/**
 * The builds and lints at the end of a turn that changed the draft's code, in any conversation
 * of the thread whose extension runs them as it yields, and the notes a turn's code writes leave
 * for them.
 */
export class TurnEndBuilds {
  readonly #thread: TurnEndThread;

  /** The turn whose base `noteBase` noted. */
  #baseNotedFor: string | undefined;

  constructor(thread: TurnEndThread) {
    this.#thread = thread;
  }

  /**
   * Notes that the turn of `invocation` changed code, before the write lands: its end builds and
   * lints, which an Artifact Agent's answer ending it would skip.
   */
  async noteCodeWrite(invocation: InConversation) {
    const turn = await turnOf(invocation);
    if (turn !== undefined)
      await this.#thread.storage.put(`${TURN_WROTE_CODE_PREFIX}${turn}`, true);
  }

  /** Whether the turn `turn` changed code. */
  async wroteCode(turn: string) {
    return (await this.#thread.storage.get(`${TURN_WROTE_CODE_PREFIX}${turn}`)) !== undefined;
  }

  /**
   * Notes the commit the draft's code is at as a turn first writes it, before the write lands:
   * the end of the turn lints the files changed since. Never fails the write: a turn without
   * its base lints the files changed since the draft's last revision.
   */
  async noteBase(invocation: InConversation, draftId: string) {
    try {
      const turn = await turnOf(invocation);
      if (turn === undefined || this.#baseNotedFor === turn) return;
      const key = `${TURN_BASE_PREFIX}${turn}`;
      if ((await this.#thread.storage.get<string>(key)) === undefined) {
        const { head } = await this.#thread.env.DRAFT_CODE.getByName(draftId).merges();
        await this.#thread.storage.put(key, head);
      }
      this.#baseNotedFor = turn;
    } catch (error) {
      console.warn("A turn's first code write didn't note its base", error);
    }
  }

  /**
   * As an agent ends a turn in the conversation of `invocation`, builds the code it changed,
   * unless its last `build` covered it without errors, and returns what Pi's `onYield` returns: a
   * message that keeps the turn going, or none to end it. A build with errors, its own or its
   * type check's, hands the agent them, and its turn goes on, until the end of the turn failed
   * `END_OF_TURN_BUILD_FAILURES` times in a row: the changes are then committed anyway, and the
   * agent explains the problem, which ends its turn, even if it changed code again. The files
   * the turn changed are linted beside the build: findings in code that builds are handed to the
   * agent too, and count as a failure, though the turn ends with them once they're one too many.
   * Editors see a status line rather than these messages. A build Camox's infrastructure keeps
   * failing lets the turn end.
   */
  async atTurnEnd(invocation: InConversation): Promise<{ continue: string } | undefined> {
    const thread = this.#thread;
    const draftId = await thread.draftWithCode();
    if (!draftId) return undefined;
    const { api, context } = invocation;
    const live = await api.snapshot(LiveDoc, api.conversationId, context);
    const run = live?.run && { threadId: thread.threadId(), runId: String(live.run.taskId) };
    const turn = (await turnOf(invocation)) ?? "";
    const failures = `${TURN_BUILD_FAILURES_PREFIX}${turn}`;
    const failedInARow = (await thread.storage.get<number>(failures)) ?? 0;
    const baseKey = `${TURN_BASE_PREFIX}${turn}`;
    const wroteKey = `${TURN_WROTE_CODE_PREFIX}${turn}`;
    // Live's code merges once the thread's turn ends, never between a Code Agent's requests.
    const merge = async () => {
      if (api.conversationId === ROOT_CONVERSATION_ID) await thread.mergeAfterTheTurn(draftId);
    };
    // The agent was told to explain the errors it couldn't fix, and did: its turn ends.
    if (failedInARow >= END_OF_TURN_BUILD_FAILURES) {
      await thread.storage.delete([failures, baseKey, wroteKey]);
      await merge();
      return undefined;
    }
    const base = await thread.storage.get<string>(baseKey);
    let built: TurnBuild;
    try {
      built = await thread.buildingSerially(draftId, () =>
        buildAtEndOfTurn(thread.env, draftId, {
          run,
          failedInARow,
          building: () => thread.showBuildStatus("building"),
          base,
        }),
      );
    } catch (error) {
      // The draft shows it's building until Camox's retry builds what the turn changed.
      console.error("A turn ended without building its code changes", error);
      await thread.env.DRAFT_CODE.getByName(draftId)
        .oweBuild({ threadId: thread.threadId() })
        .catch((owed: unknown) => console.error("A draft's build wasn't retried", owed));
      return undefined;
    }
    await thread.env.DRAFT_CODE.getByName(draftId).settleOwedBuild();
    if ("result" in built)
      await thread.timeTurnRevision(built.result, { draftId, runId: run?.runId });
    if (built.outcome === "failed") {
      await thread.storage.put(failures, failedInARow + 1);
      await thread.showBuildStatus("fixing");
      return { continue: fixBuild(built.result) };
    }
    if (
      built.outcome === "committedUnbuilt" ||
      built.outcome === "keptErrors" ||
      built.outcome === "uncommitted"
    ) {
      await thread.storage.put(failures, END_OF_TURN_BUILD_FAILURES);
      return { continue: explainFailures(built) };
    }
    if (built.outcome === "linted") {
      await thread.storage.put(failures, failedInARow + 1);
      await thread.showBuildStatus("fixing");
      return { continue: fixLint(built.result) };
    }
    await thread.storage.delete([failures, baseKey, wroteKey]);
    await merge();
    return undefined;
  }
}
