import type { Logger } from "vite-plus";

import type { ServerApiClient } from "../../lib/api-client-server";

/**
 * Publishes the content dev mode seeded into the development draft, so a fresh database starts
 * with it on Live and the draft only holds the developer's own changes. Failures are warnings:
 * the content stays in the draft, where it can still be published by hand.
 */
export async function publishSeededContent(options: {
  /** Sends the dev session and names the development draft. */
  client: ServerApiClient;
  projectSlug: string;
  logger: Logger;
}): Promise<void> {
  const { client, projectSlug, logger } = options;
  try {
    const project = await client.projects.getBySlug({ slug: projectSlug });
    const preview = await client.drafts.previewPublish({ projectId: project.id });
    if (preview.changes.length === 0) return;
    if (preview.blockers.length > 0) {
      const blockers = preview.blockers.map((blocker) => blocker.message).join("; ");
      logger.warn(
        `[camox] Seeded content stays in your development draft; publishing is blocked: ${blockers}`,
        { timestamp: true },
      );
      return;
    }
    await client.drafts.publish({ projectId: project.id, token: preview.token });
    logger.info(
      `[camox] Published ${preview.changes.length} seeded change${preview.changes.length === 1 ? "" : "s"} to Live`,
      { timestamp: true },
    );
  } catch (error) {
    logger.warn(`[camox] Publishing seeded content failed: ${String(error)}`, { timestamp: true });
  }
}
