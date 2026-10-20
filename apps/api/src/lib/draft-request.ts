import { DEVELOPMENT_DRAFT, DRAFT_CREATE_HEADER, DRAFT_HEADER } from "@camox/api-contract/drafts";
import { uuidv7Schema } from "@camox/api-contract/ids";

import type { DraftRequest } from "../domains/drafts/scope";

/** Why a request's draft header names no draft. */
export const INVALID_DRAFT_HEADER = `${DRAFT_HEADER} must be a UUIDv7 or "${DEVELOPMENT_DRAFT}"`;

/**
 * The draft a request names as the studio does: a draft's id, which `create` asks to create when
 * missing, or `development` for the caller's development draft. Undefined when it's neither.
 */
export function draftRequestNamed(name: string, create: boolean): DraftRequest | undefined {
  if (name === DEVELOPMENT_DRAFT) return { development: true };
  if (!uuidv7Schema.safeParse(name).success) return undefined;
  return { id: name, create };
}

/**
 * The draft a request names in its headers (ADR 0011): null when it names none, which means Live,
 * or "invalid" when its draft header names no draft.
 */
export function draftRequestOf(headers: Headers): DraftRequest | null | "invalid" {
  const name = headers.get(DRAFT_HEADER);
  if (!name) return null;
  return draftRequestNamed(name, headers.get(DRAFT_CREATE_HEADER) === "1") ?? "invalid";
}
