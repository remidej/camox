import {
  DRAFT_CREATE_HEADER,
  DRAFT_HEADER,
  DEVELOPMENT_DRAFT,
  LOCALE_HEADER,
} from "@camox/api-contract/drafts";
import { uuidv7Schema } from "@camox/api-contract/ids";
import { os, ORPCError } from "@orpc/server";

import type { Database } from "./db";
import type { Auth } from "./domains/auth/routes";
import type { DraftRequest } from "./domains/drafts/scope";
import { LiveReadOnlyError } from "./lib/errors";
import { toORPCError } from "./lib/run-service";
import type { Bindings } from "./types";

// --- Context types ---

export type BaseContext = {
  db: Database;
  user: Auth["$Infer"]["Session"]["user"] | null;
  session: Auth["$Infer"]["Session"]["session"] | null;
  env: Bindings;
  headers: Headers;
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
  if (id === DEVELOPMENT_DRAFT) return { development: true };
  if (!uuidv7Schema.safeParse(id).success) {
    throw new ORPCError("BAD_REQUEST", {
      message: `${DRAFT_HEADER} must be a UUIDv7 or "${DEVELOPMENT_DRAFT}"`,
    });
  }
  return { id, create: headers.get(DRAFT_CREATE_HEADER) === "1" };
}

/**
 * Public procedure — available to anyone, no auth required. Every procedure gets the draft
 * its request names as `context.draft`, and the locale as `context.locale`; services check both
 * through content access (`accessTo`).
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
  .use(({ context, next }) =>
    next({
      context: {
        draft: draftRequestOf(context.headers),
        locale: context.headers.get(LOCALE_HEADER) ?? undefined,
      },
    }),
  );

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

/** The error a content write naming no draft fails with: Live is read-only (ADR 0003). */
export const liveReadOnlyError = () => toORPCError(new LiveReadOnlyError());

/** Rejects a request naming no draft: Live is read-only. */
export const requireDraft = os
  .$context<{ draft: DraftRequest | null }>()
  .middleware(({ context, next }) => {
    if (!context.draft) throw liveReadOnlyError();
    return next();
  });

/**
 * Content write procedure — requires an authenticated user and a draft (ADR 0003, ADR 0011).
 * Content reaches Live only by publishing a draft or through a release, so a write naming no
 * draft is rejected before its input is read. Every procedure built on it is listed as a
 * content write in `@camox/api-contract/drafts`, which the studio follows to start a draft.
 */
export const contentWrite = authed.use(requireDraft);
