import { sendAlert } from "../../lib/alert-email";
import type { Bindings } from "../../types";

/**
 * What's wrong with Camox's OpenRouter account when a model call fails because of it, rather than
 * because of the call: no retry and no other thread gets through until someone fixes it.
 * `credits`: the account or its key ran out of credit, or hit its spending limit (402). `key`:
 * OpenRouter doesn't accept the key (401).
 */
export type AccountProblem = "credits" | "key";

/** The account problem a failed model call's error names, if it names one. */
export function accountProblemOf(errorMessage: string | undefined): AccountProblem | undefined {
  // pi-ai's error messages start with the response's status.
  const status = errorMessage?.match(/^(\d{3})\b/)?.[1];
  if (status === "402") return "credits";
  if (status === "401") return "key";
  return undefined;
}

const OPENROUTER_KEYS_URL = "https://openrouter.ai/settings/keys";

const FAILURES: Record<AccountProblem, string> = {
  credits:
    "OpenRouter turned down a call of Camox's agent for lack of credit: the account's balance or the key's spending limit doesn't cover it. Every agent turn fails until it does.",
  key: "OpenRouter turned down a call of Camox's agent because it doesn't accept the API's key. Every agent turn fails until the key is replaced.",
};

export type FailedModelCall = {
  problem: AccountProblem;
  /** The thread's project, by its Project ID. */
  projectId: string;
  /** The thread's draft, or null on Live. */
  draftId: string | null;
  threadId: string;
  /** The error the model call ended with. */
  error: string;
};

/** Emails the alerts address that the agent's model calls fail for a reason of the account. */
export function sendModelAccountAlert(env: Bindings, call: FailedModelCall): Promise<void> {
  return sendAlert(env, {
    subject:
      call.problem === "credits"
        ? "Camox's agent is out of OpenRouter credit"
        : "Camox's agent can't use its OpenRouter key",
    failure: FAILURES[call.problem],
    details: [
      { label: "Project ID", value: call.projectId },
      { label: "Draft", value: call.draftId ?? "Live" },
      { label: "Thread", value: call.threadId },
      // Long enough for OpenRouter's message, which says how much the key can still afford.
      { label: "Error", value: call.error.slice(0, 500) },
    ],
    link: { label: "Open OpenRouter's API keys", url: OPENROUTER_KEYS_URL },
  });
}
