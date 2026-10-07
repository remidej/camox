import { and, eq } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../db";
import { environments } from "../schema";
import { NotFoundError } from "./errors";

export const resolveEnvironment = Effect.fn("resolveEnvironment")(function* (
  db: Database,
  projectId: number,
  environmentName: string,
  options?: { autoCreate?: boolean },
) {
  let environment = yield* Effect.promise(() =>
    db
      .select()
      .from(environments)
      .where(and(eq(environments.projectId, projectId), eq(environments.name, environmentName)))
      .get(),
  );

  let created = false;

  if (!environment && options?.autoCreate) {
    const now = Date.now();
    environment = yield* Effect.promise(() =>
      db
        .insert(environments)
        .values({
          projectId,
          name: environmentName,
          type: "development",
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get(),
    );
    created = true;
  }

  if (!environment) {
    return yield* new NotFoundError({ message: `Environment "${environmentName}" not found` });
  }
  return { ...environment, created };
});
