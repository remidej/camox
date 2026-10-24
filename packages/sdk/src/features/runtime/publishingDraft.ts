import { PUBLISHING_DRAFT_VAR } from "@camox/api-contract/drafts";

/**
 * The Worker a publish with code uploaded carries the publishing draft's ID as a variable
 * (`PUBLISHING_DRAFT_VAR`). Its reads of the API name that draft, so while the draft publishes
 * they see Live overlaid with it, the content its code was previewed with. Once the draft has
 * ended, the API reads Live for them. The variable is the same for every request a Worker
 * serves, so it's kept from the first.
 */
const PUBLISHING_DRAFT_GLOBAL = "__CAMOX_PUBLISHING_DRAFT__";

/** Keeps the publishing draft a Worker's environment names, if it names one. */
export function rememberPublishingDraft(env: unknown): void {
  const draft = (env as Record<string, unknown> | null | undefined)?.[PUBLISHING_DRAFT_VAR];
  if (typeof draft === "string" && draft) {
    (globalThis as Record<string, unknown>)[PUBLISHING_DRAFT_GLOBAL] = draft;
  }
}

/** The draft this Worker publishes, if a publish with code uploaded it. */
export function publishingDraft(): string | undefined {
  return (globalThis as Record<string, unknown>)[PUBLISHING_DRAFT_GLOBAL] as string | undefined;
}
