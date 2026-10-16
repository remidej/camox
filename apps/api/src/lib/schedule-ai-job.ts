type AiJobType = "summary" | "fileMetadata" | "seo";
type EntityTable = "blocks" | "repeatableItems" | "files" | "pages";

/**
 * Names a job: its Durable Object, and its logs. A draft's job and Live's job on the same entity
 * run apart instead of replacing each other.
 */
export function aiJobKey(job: {
  entityTable: string;
  entityId: string;
  type: string;
  draftId?: string | null;
}) {
  return `${job.entityTable}:${job.entityId}:${job.type}:${job.draftId ?? "live"}`;
}

export function scheduleAiJob(
  doNamespace: DurableObjectNamespace,
  options: {
    type: AiJobType;
    delayMs: number;
    entityTable: EntityTable;
    entityId: string;
    /**
     * The draft the job was scheduled from, which it writes in (ADR 0012). Absent or null for
     * Live, and for content that doesn't live in drafts yet.
     */
    draftId?: string | null;
  },
) {
  const id = doNamespace.idFromName(aiJobKey(options));
  const stub = doNamespace.get(id);
  return stub.fetch("http://do/schedule", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  });
}
