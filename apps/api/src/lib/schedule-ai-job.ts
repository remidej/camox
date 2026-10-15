type AiJobType = "summary" | "fileMetadata" | "seo";
type EntityTable = "blocks" | "repeatableItems" | "files" | "pages";

export function scheduleAiJob(
  doNamespace: DurableObjectNamespace,
  options: {
    type: AiJobType;
    delayMs: number;
    entityTable: EntityTable;
    entityId: string;
  },
) {
  const name = `${options.entityTable}:${options.entityId}:${options.type}`;
  const id = doNamespace.idFromName(name);
  const stub = doNamespace.get(id);
  return stub.fetch("http://do/schedule", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  });
}
