// What publishing the development draft would do, as the `previewPublish` tool returns it
// (ADR 0009), and its plain-text rendering for a terminal.

type Owner =
  | { kind: "page"; id: string; path: string; nickname: string }
  | { kind: "layout"; name: string }
  | { kind: "syncedBlock"; name: string; title: string }
  | { kind: "collection"; name: string; title: string }
  | null;

type Subject = { entity: string; id: string; label: string; owner: Owner };

type Problem = Subject & { code: string; field: string; message: string };

export type PublishPreview = {
  blockers: Problem[];
  conflicts: (Subject & {
    liveVersion: number | null;
    publishedBy: { id: string; name: string } | null;
    publishedAt: number | null;
    release: boolean;
  })[];
  lost: (Subject & { reason: "parentGone" | "writtenAfterDeletion" })[];
  warnings: Problem[];
  changes: (Subject & { change: "created" | "changed" | "deleted" })[];
  token: string;
};

function where(owner: Owner): string {
  if (!owner) return "";
  switch (owner.kind) {
    case "page":
      return ` on page ${owner.path}`;
    case "layout":
      return ` in layout ${owner.name}`;
    case "syncedBlock":
      return ` in synced block ${owner.title}`;
    case "collection":
      return ` in collection ${owner.title}`;
  }
}

const subject = (item: Subject) => `${item.entity} "${item.label}"${where(item.owner)}`;

const when = (at: number | null) => (at === null ? "" : ` on ${new Date(at).toLocaleString()}`);

function conflictLine(conflict: PublishPreview["conflicts"][number]): string {
  if (conflict.liveVersion === null) return `${subject(conflict)}: deleted on Live`;
  if (conflict.release)
    return `${subject(conflict)}: changed by a release${when(conflict.publishedAt)}`;
  const by = conflict.publishedBy?.name ?? "someone";
  return `${subject(conflict)}: published by ${by}${when(conflict.publishedAt)}`;
}

const LOST_REASONS = {
  parentGone: "what it belongs to is gone from Live and the draft",
  writtenAfterDeletion: "published after the draft deleted what it belongs to",
};

function section(title: string, lines: string[]): string[] {
  if (lines.length === 0) return [];
  return [`${title} (${lines.length})`, ...lines.map((line) => `  - ${line}`), ""];
}

/** The preview as text, in the order ADR 0009 lists it, ending with the token. */
export function formatPreview(preview: PublishPreview): string {
  const lines = [
    ...section(
      "Blockers: fix these in your development draft before publishing",
      preview.blockers.map((problem) => `${subject(problem)}: ${problem.message}`),
    ),
    ...section(
      "Conflicts: Live changed these since your draft did; publishing overwrites Live's version",
      preview.conflicts.map(conflictLine),
    ),
    ...section(
      "Lost changes: publishing drops these",
      preview.lost.map((lost) => `${subject(lost)}: ${LOST_REASONS[lost.reason]}`),
    ),
    ...section(
      "Warnings: already on Live, not blocking",
      preview.warnings.map((problem) => `${subject(problem)}: ${problem.message}`),
    ),
    ...section(
      "Changes",
      preview.changes.map((change) => `${change.change} ${subject(change)}`),
    ),
  ];
  if (preview.changes.length === 0) lines.push("Your development draft has no changes.", "");
  lines.push(`Token: ${preview.token}`);
  if (preview.blockers.length > 0) {
    lines.push("Publishing is blocked until the blockers are fixed.");
  } else if (preview.changes.length > 0) {
    lines.push(`Publish with: camox publish --confirm ${preview.token}`);
  }
  return `${lines.join("\n")}\n`;
}
