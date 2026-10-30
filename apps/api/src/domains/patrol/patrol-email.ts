import { DRAFT_SEARCH_PARAM } from "@camox/api-contract/drafts";
import type { FindingView } from "@camox/api-contract/patrol";
import { projectWebsiteUrl } from "@camox/api-contract/projects";
import { and, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";

import type { Database } from "../../db";
import { escapeHtml, sendEmail } from "../../lib/email";
import type { Bindings } from "../../types";
import { member, user } from "../auth/schema";
import { findingLine } from "../drafts/publish";
import { projects } from "../projects/schema";
import type { Patroller } from "./patrollers";
import { patrolEmailUnsubscribes } from "./schema";

// The email about Live's new findings (ADR 0034): each Live run that raised new findings tells
// every member of the project, once, what they are and where the Patrol Draft fixing them is.
// Each email carries a link that unsubscribes its member from the project's emails, signed by
// the API so no one else can unsubscribe them.

const PATROL_EMAIL_SENDER = { name: "Camox", email: "patrol@camox.ai" };

/** Where the unsubscribe links lead, under the API's origin (`patrolEmailRoutes`). */
export const UNSUBSCRIBE_PATH = "/patrol-emails/unsubscribe";

/** One member's unsubscribe from one project's emails, as its link names it. */
export type Unsubscribe = { projectId: number; userId: string };

const encoder = new TextEncoder();

/** The key unsubscribe links are signed with, derived from the API's auth secret. */
const signingKey = (env: Pick<Bindings, "BETTER_AUTH_SECRET">) =>
  crypto.subtle.importKey(
    "raw",
    encoder.encode(`camox-patrol-email-unsubscribe:${env.BETTER_AUTH_SECRET}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );

const signed = ({ projectId, userId }: Unsubscribe) => encoder.encode(`${projectId}:${userId}`);

const toHex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");

/** The link that unsubscribes a member from a project's emails. It doesn't expire. */
export async function unsubscribeUrl(
  env: Pick<Bindings, "BETTER_AUTH_SECRET" | "API_URL">,
  unsubscribe: Unsubscribe,
) {
  const signature = await crypto.subtle.sign("HMAC", await signingKey(env), signed(unsubscribe));
  const url = new URL(UNSUBSCRIBE_PATH, env.API_URL);
  url.searchParams.set("project", String(unsubscribe.projectId));
  url.searchParams.set("user", unsubscribe.userId);
  url.searchParams.set("token", toHex(signature));
  return url.href;
}

/** The unsubscribe an unsubscribe link's query names, or null when the API didn't sign it. */
export async function verifiedUnsubscribe(
  env: Pick<Bindings, "BETTER_AUTH_SECRET">,
  query: { project?: string; user?: string; token?: string },
): Promise<Unsubscribe | null> {
  const { project, user: userId, token } = query;
  if (!project || !/^[1-9]\d*$/.test(project) || !userId || !token) return null;
  if (!/^(?:[0-9a-f]{2})+$/.test(token)) return null;
  const unsubscribe = { projectId: Number(project), userId };
  const signature = Uint8Array.from(token.match(/../g)!, (byte) => parseInt(byte, 16));
  const valid = await crypto.subtle.verify(
    "HMAC",
    await signingKey(env),
    signature,
    signed(unsubscribe),
  );
  return valid ? unsubscribe : null;
}

/** Unsubscribes a member from a project's emails about Live's new findings. */
export async function unsubscribe(db: Database, { projectId, userId }: Unsubscribe) {
  await db
    .insert(patrolEmailUnsubscribes)
    .values({ projectId, userId, at: Date.now() })
    .onConflictDoNothing();
}

/** What the email says of the findings left for a person: those without a fix to apply. */
const whatsLeft = (found: readonly FindingView[]) => {
  const left = found.filter((finding) => finding.fix === null).length;
  if (left === 0) {
    return "Camox's agent is fixing them in the Patrol Draft: review its changes there, and publish them.";
  }
  return (
    `Camox's agent is fixing what it can in the Patrol Draft. ` +
    `${left} ${left === 1 ? "needs" : "need"} you: it asks about ${left === 1 ? "it" : "them"} in the draft's thread.`
  );
};

/**
 * Emails every member of the project, but those who unsubscribed, about the findings a
 * patroller's Live run raised that are new, and the Patrol Draft fixing them. A send that fails
 * is logged, not retried: the findings are in the Patrol Draft all the same.
 */
export const emailNewFindings = Effect.fn("patrol.emailNewFindings")(function* (
  db: Database,
  env: Bindings,
  params: {
    patroller: Patroller;
    projectId: number;
    draftId: string;
    found: readonly FindingView[];
  },
) {
  const { patroller, projectId, draftId, found } = params;
  const project = yield* Effect.promise(() =>
    db
      .select({
        name: projects.name,
        slug: projects.slug,
        customDomain: projects.customDomain,
        organizationId: projects.organizationId,
      })
      .from(projects)
      .where(eq(projects.id, projectId))
      .get(),
  );
  if (!project) return;
  const recipients = yield* Effect.promise(() =>
    db
      .select({ id: user.id, email: user.email })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .leftJoin(
        patrolEmailUnsubscribes,
        and(
          eq(patrolEmailUnsubscribes.projectId, projectId),
          eq(patrolEmailUnsubscribes.userId, member.userId),
        ),
      )
      .where(
        and(
          eq(member.organizationId, project.organizationId),
          isNull(patrolEmailUnsubscribes.rowId),
        ),
      )
      .all(),
  );

  const studioLink = new URL("/", projectWebsiteUrl(project));
  studioLink.searchParams.set(DRAFT_SEARCH_PARAM, draftId);
  const problems = found.length === 1 ? "a new problem" : `${found.length} new problems`;
  const subject = `The ${patroller.role} found ${problems} on ${project.name}`;
  const intro = `The ${patroller.role} found ${problems} on ${project.name}'s website:`;
  const lines = found.map((finding) => `${findingLine(finding)}.`);
  const left = whatsLeft(found);
  const action = { label: "Open the Patrol Draft", url: studioLink.href };

  yield* Effect.forEach(
    recipients,
    (recipient) =>
      Effect.tryPromise(async () => {
        const unsubscribeLink = await unsubscribeUrl(env, { projectId, userId: recipient.id });
        const why = `You get these emails as a member of ${project.name}.`;
        await sendEmail(env, {
          from: PATROL_EMAIL_SENDER,
          to: recipient.email,
          subject,
          text: [
            intro,
            ...lines.map((line) => `- ${line}`),
            "",
            left,
            "",
            `${action.label}: ${action.url}`,
            "",
            `${why} Unsubscribe: ${unsubscribeLink}`,
          ].join("\n"),
          title: subject,
          preheader: left,
          contentHtml: `<tr><td style="font-size:16px;line-height:24px;padding-bottom:12px">${escapeHtml(intro)}</td></tr>
            <tr><td style="padding-bottom:16px"><ul style="margin:0;padding-left:20px;font-size:16px;line-height:24px">${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul></td></tr>
            <tr><td style="font-size:16px;line-height:24px;padding-bottom:24px">${escapeHtml(left)}</td></tr>`,
          action,
          footerHtml: `<tr><td style="font-size:13px;line-height:20px;color:#737373">${escapeHtml(why)} <a href="${escapeHtml(unsubscribeLink)}" style="color:#404040">Unsubscribe</a></td></tr>`,
          // One-click unsubscribing from the inbox (RFC 8058).
          headers: {
            "List-Unsubscribe": `<${unsubscribeLink}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        });
      }).pipe(
        Effect.catch((error) =>
          Effect.logError(`[patrol] the email about Live's new findings wasn't sent`, error),
        ),
      ),
    { concurrency: 4, discard: true },
  );
});
