import { CAMOX_ACTOR, CAMOX_NAME } from "@camox/api-contract/drafts";
import { inArray } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import { user as users } from "../auth/schema";

// Who created, published or ended a draft, by the id it stores: a member, or Camox for its own
// work, such as the catch-up drafts it opens and publishes.

export type Person = { id: string; name: string };

/**
 * The people these ids name, by id: members by their name, and Camox. An id naming nobody now,
 * such as a departed member's, is missing.
 */
export const peopleNamed = Effect.fn("drafts.peopleNamed")(function* (
  db: Database,
  ids: readonly string[],
) {
  const members = [...new Set(ids)].filter((id) => id !== CAMOX_ACTOR);
  const rows = members.length
    ? yield* Effect.promise(() =>
        db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, members)),
      )
    : [];
  const people = new Map<string, Person>(rows.map((row) => [row.id, row]));
  people.set(CAMOX_ACTOR, { id: CAMOX_ACTOR, name: CAMOX_NAME });
  return people;
});

/** The person an id names, or a former member when it names nobody now. */
export const personOf = (people: ReadonlyMap<string, Person>, id: string): Person =>
  people.get(id) ?? { id, name: "A former member" };
