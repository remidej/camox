import { projectIdSchema } from "@camox/api-contract/ids";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";

import { assertOrgMembership, requireUser } from "../../authorization";
import { decodeInput, ForbiddenError, NotFoundError } from "../../lib/errors";
import { projects } from "../../schema";
import type { ServiceContext } from "../_shared/service-context";

/** How long a read token lasts. Git asks the CLI's credential helper for another once it expires. */
const READ_TOKEN_TTL_SECONDS = 60 * 60;

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
  const project = yield* Effect.promise(() =>
    ctx.db.select().from(projects).where(eq(projects.uuid, projectUuid)).get(),
  );
  if (!project) return yield* new NotFoundError();
  yield* assertOrgMembership(ctx.db, user.id, project.organizationId);
  if (!project.codeOutsideCamox) {
    return yield* new ForbiddenError({
      message: `${project.name}'s code can't be worked on outside Camox: it's only cloned or pushed to on projects that allow it.`,
    });
  }

  const { remote, token } = yield* Effect.promise(async () => {
    using repo = await ctx.env.ARTIFACTS.get(project.uuid);
    const [info, token] = await Promise.all([
      repo.info(),
      repo.createToken("read", READ_TOKEN_TTL_SECONDS),
    ]);
    return { remote: info.remote, token };
  });
  return {
    remote,
    // Artifacts tokens read `<secret>?expires=<unix seconds>`; Git's Basic auth takes the secret.
    token: token.plaintext.split("?expires=")[0],
    expiresAt: token.expiresAt,
    projectSlug: project.slug,
  };
});
