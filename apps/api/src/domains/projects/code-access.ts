import { projectIdSchema } from "@camox/api-contract/ids";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";

import { assertOrgMembership, requireUser } from "../../authorization";
import { decodeInput, ForbiddenError, NotFoundError } from "../../lib/errors";
import { projects } from "../../schema";
import type { Bindings } from "../../types";
import type { ServiceContext } from "../_shared/service-context";

/**
 * How long a member's read token lasts: it serves their Git commands for a while, and Git asks
 * the CLI's credential helper for another once it expires.
 */
const MEMBER_READ_TOKEN_TTL_SECONDS = 60 * 60;

/**
 * The Git remote of the project's repo `repo`, and a read token for it lasting `ttlSeconds`.
 * The token's `plaintext` reads `<secret>?expires=<unix seconds>`: a Bearer header takes it
 * whole, Git's Basic auth takes the secret.
 */
export async function readAccess(env: Bindings, repo: string, ttlSeconds: number) {
  using artifacts = await env.ARTIFACTS.get(repo);
  const [{ remote }, token] = await Promise.all([
    artifacts.info(),
    artifacts.createToken("read", ttlSeconds),
  ]);
  return { remote, token };
}

/**
 * The project `projectUuid`, for a member of its organization, when its code can be worked on
 * outside Camox (ADR 0026): cloning and pushing both need it. A non-member isn't told whether
 * the project allows it.
 */
export const projectWithCodeOutsideCamox = Effect.fn("projects.withCodeOutsideCamox")(function* (
  ctx: ServiceContext,
  userId: string,
  projectUuid: string,
) {
  const project = yield* Effect.promise(() =>
    ctx.db.select().from(projects).where(eq(projects.uuid, projectUuid)).get(),
  );
  if (!project) return yield* new NotFoundError();
  yield* assertOrgMembership(ctx.db, userId, project.organizationId);
  if (!project.codeOutsideCamox) {
    return yield* new ForbiddenError({
      message: `${project.name}'s code can't be worked on outside Camox: it's only cloned or pushed to on projects that allow it.`,
    });
  }
  return project;
});

export const createCodeReadTokenInput = z.object({ projectUuid: projectIdSchema });

/**
 * A short-lived read token for a project's repo, and its Git remote, for a member of its
 * organization when its code can be worked on outside Camox (ADR 0026). The token is the secret
 * Git sends as its password: Cloudflare Artifacts ignores the username.
 */
export const createCodeReadToken = Effect.fn("projects.createCodeReadToken")(function* (
  ctx: ServiceContext,
  rawInput: z.input<typeof createCodeReadTokenInput>,
) {
  const user = yield* requireUser(ctx);
  const { projectUuid } = yield* decodeInput(createCodeReadTokenInput, rawInput);
  const project = yield* projectWithCodeOutsideCamox(ctx, user.id, projectUuid);

  const { remote, token } = yield* Effect.promise(() =>
    readAccess(ctx.env, project.uuid, MEMBER_READ_TOKEN_TTL_SECONDS),
  );
  return {
    remote,
    // Git's Basic auth takes the secret alone.
    token: token.plaintext.split("?expires=")[0],
    expiresAt: token.expiresAt,
    projectSlug: project.slug,
  };
});
