// What publishing the development draft would do, as the `previewPublish` tool returns it
// (ADR 0009), and its plain-text rendering for a terminal.

import type { PublishPreview } from "@camox/api-contract";

export type { PublishPreview };

type Subject = Omit<PublishPreview["changes"][number], "change">;
type Owner = Subject["owner"];

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

type Changed = PublishPreview["changes"][number];

const changeLine = (change: Changed) => `${change.change} ${subject(change)}`;

/**
 * The draft's changes, under the locale each is in once the draft changes more than its default
 * locale: the default locale first, then the others, then what every locale shares, like files.
 */
function changesSection(preview: PublishPreview): string[] {
  const { changes, defaultLocale } = preview;
  const tags = new Set(changes.map((change) => change.locale));
  if ([...tags].every((tag) => tag === null || tag === defaultLocale)) {
    return section("Changes", changes.map(changeLine));
  }
  const rank = (tag: string | null) => (tag === defaultLocale ? 0 : tag === null ? 2 : 1);
  const ordered = [...tags].sort((a, b) => rank(a) - rank(b) || (a ?? "").localeCompare(b ?? ""));
  return [
    `Changes (${changes.length})`,
    ...ordered.flatMap((tag) => [
      `  ${tag ?? "Every locale"}`,
      ...changes
        .filter((change) => change.locale === tag)
        .map((change) => `    - ${changeLine(change)}`),
    ]),
    "",
  ];
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
    ...changesSection(preview),
  ];
  if (preview.changes.length === 0) lines.push("Your development draft has no changes.", "");
  lines.push(`Token: ${preview.token}`, ...nextStep(preview));
  return `${lines.join("\n")}\n`;
}

/**
 * What to do next: fix the blockers, or publish when there is something to publish, waiting for
 * running translations or publishing anyway.
 */
function nextStep(preview: PublishPreview): string[] {
  if (preview.blockers.length > 0) return ["Publishing is blocked until the blockers are fixed."];
  if (preview.changes.length === 0) return [];
  const publish = `camox publish --confirm ${preview.token}`;
  if (preview.translating.length > 0) {
    return [
      `Translations into ${preview.translating.join(", ")} are still running: publish once they finish, or publish anyway and Camox finishes them in a draft of its own.`,
      `Publish anyway with: ${publish} --anyway`,
    ];
  }
  return [`Publish with: ${publish}`];
}
