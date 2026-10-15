import { DRAFT_CREATE_HEADER, DRAFT_HEADER } from "@camox/api-contract/drafts";
import { uuidv7Schema } from "@camox/api-contract/ids";
import { os, ORPCError } from "@orpc/server";

import type { Database } from "./db";
import type { Auth } from "./domains/auth/routes";
import type { DraftRequest } from "./domains/drafts/scope";
import type { Bindings } from "./types";

// --- Context types ---

export type BaseContext = {
  db: Database;
  user: Auth["$Infer"]["Session"]["user"] | null;
  session: Auth["$Infer"]["Session"]["session"] | null;
  env: Bindings;
  headers: Headers;
  environmentName: string;
  client: string;
  telemetryDisabled: boolean;
  waitUntil: (promise: Promise<unknown>) => void;
};

export type AuthedContext = BaseContext & {
  user: Auth["$Infer"]["Session"]["user"];
  session: Auth["$Infer"]["Session"]["session"];
};

// --- Base procedures ---

/** Read the draft a request names from its headers. No header means Live (ADR 0011). */
function draftRequestOf(headers: Headers): DraftRequest | null {
  const id = headers.get(DRAFT_HEADER);
  if (!id) return null;
  if (!uuidv7Schema.safeParse(id).success) {
    throw new ORPCError("BAD_REQUEST", { message: `${DRAFT_HEADER} must be a UUIDv7` });
  }
  return { id, create: headers.get(DRAFT_CREATE_HEADER) === "1" };
}

/**
 * Public procedure — available to anyone, no auth required. Every procedure gets the draft
 * its request names as `context.draft`; services check it with `requireDraftScope`.
 */
export const pub = os
  .$context<BaseContext>()
  .use(async ({ next, path }) => {
    try {
      return await next();
    } catch (error) {
      if (error instanceof ORPCError && error.status < 500) {
        throw error;
      }
      console.error(`[oRPC] ${path.join(".")} →`, error);
      throw error;
    }
  })
  .use(({ context, next }) => next({ context: { draft: draftRequestOf(context.headers) } }));

/** Authed procedure — requires authenticated user */
export const authed = pub.use(async ({ context, next }) => {
  if (!context.user || !context.session) {
    throw new ORPCError("UNAUTHORIZED");
  }

  return next({
    context: {
      ...context,
      user: context.user,
      session: context.session,
    },
  });
});
