import { asc, eq } from "drizzle-orm";

import type { Database } from "../../db";
import { member, projects, user } from "../../schema";

/** A project a Connected Agent's member can reach. */
export type MemberProject = typeof projects.$inferSelect;

/**
 * The member a Connected Agent acts as, loaded on every call: access follows membership as it is
 * now, not as it was when the agent connected (ADR 0030).
 */
export type ConnectedMember = {
  user: typeof user.$inferSelect;
  /** Every project of every organization the member belongs to, in a stable order. */
  projects: MemberProject[];
};

export async function loadConnectedMember(
  db: Database,
  userId: string,
): Promise<ConnectedMember | null> {
  const [found, reachable] = await Promise.all([
    db.select().from(user).where(eq(user.id, userId)).get(),
    db
      .select({ project: projects })
      .from(member)
      .innerJoin(projects, eq(projects.organizationId, member.organizationId))
      .where(eq(member.userId, userId))
      .orderBy(asc(projects.id))
      .all(),
  ]);
  return found ? { user: found, projects: reachable.map(({ project }) => project) } : null;
}
