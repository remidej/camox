import type { FindingView, PatrolView } from "@camox/api-contract/patrol";
import { Alert, AlertDescription, AlertTitle } from "@camox/ui/alert";
import { Button } from "@camox/ui/button";
import { toast } from "@camox/ui/toaster";
import { useMutation } from "@tanstack/react-query";
import { CircleAlert } from "lucide-react";
import * as React from "react";

import { AuthContext } from "../../../lib/auth";
import { useCurrentDraftId } from "../../../lib/draft-scope";
import { patrolMutations } from "../../../lib/queries";
import { reads, useReadQuery } from "../../../lib/studio-reads";
import { useViewLocale } from "../../../lib/view-locale-context";
import {
  askAgentMessage,
  dismissLabel,
  findingSentenceInPlace,
  fixLabel,
} from "../findingSentence";
import { useShowInCanvas } from "../showInCanvas";
import { studioStore } from "../studioStore";

// The Patrol's findings where their content is edited (ADR 0034): in the sidebar, under the field
// they're in, or at the top of their block, item or record when no field of it names them.

/** The content a sidebar edits, as findings name their subject. */
export type FindingsSubject = { entity: "block" | "repeatableItem" | "record"; id: string };

/** A finding, with the role of the patroller that raised it. */
type RoledFinding = FindingView & { role: string };

/** The open findings of the Patrol viewed in a subject, in the locale viewed. */
export function useContentFindings(subject: FindingsSubject | null) {
  const { projectUuid } = React.useContext(AuthContext)!;
  const { data: project } = useReadQuery(reads.project({ projectUuid }));
  const { data: view } = useReadQuery(reads.patrol({ projectId: project?.id ?? 0 }), {
    enabled: project !== undefined && subject !== null,
  });
  const viewed = useViewLocale().locale;
  const { data: locales } = useReadQuery(reads.localeList({ projectId: project?.id ?? 0 }), {
    enabled: project !== undefined && subject !== null,
  });
  // The default locale viewed may not say its tag yet: the project's does.
  const tag = viewed.isDefault
    ? (locales?.find((locale) => locale.isDefault)?.tag ?? viewed.tag)
    : viewed.tag;
  const findings = React.useMemo(
    () =>
      subject === null
        ? []
        : (view?.patrollers ?? []).flatMap((patroller) =>
            patroller.findings
              .filter(
                (finding) =>
                  finding.subject.entity === subject.entity &&
                  finding.subject.id === subject.id &&
                  finding.locale === tag,
              )
              .map((finding): RoledFinding => ({ ...finding, role: patroller.role })),
          ),
    [view, subject, tag],
  );
  return { projectId: project?.id, patrolDraft: view?.patrolDraft ?? null, findings };
}

export type ContentFindingsView = ReturnType<typeof useContentFindings>;

/** What a field's row says of its findings, such as "2 findings", or nothing without any. */
export function findingsHint(view: ContentFindingsView, field: string): string | undefined {
  const count = view.findings.filter((finding) => finding.field === field).length;
  if (count === 0) return undefined;
  return count === 1 ? "1 finding" : `${count} findings`;
}

/**
 * The findings in one field of a subject, as `useContentFindings` reads them, under that field's
 * editor. Without `field`, those in none of `fields`: about the subject as a whole.
 */
export function ContentFindings({
  view,
  field,
  fields,
  className,
}: {
  view: ContentFindingsView;
  className?: string;
} & ({ field: string; fields?: never } | { field?: never; fields: readonly string[] })) {
  const { projectId, patrolDraft, findings } = view;
  const shown = findings.filter((finding) =>
    field === undefined ? !fields.includes(finding.field) : finding.field === field,
  );
  if (projectId === undefined || shown.length === 0) return null;
  return (
    <div data-content-findings className={className ?? "space-y-2 px-2 pb-4"}>
      {shown.map((finding) => (
        <FindingAlert
          key={finding.id}
          projectId={projectId}
          finding={finding}
          patrolDraft={patrolDraft}
        />
      ))}
    </div>
  );
}

type PatrolDraft = NonNullable<PatrolView["patrolDraft"]>;

function FindingAlert({
  projectId,
  finding,
  patrolDraft,
}: {
  projectId: number;
  finding: RoledFinding;
  patrolDraft: PatrolDraft | null;
}) {
  const draftId = useCurrentDraftId();
  const applyFix = useMutation({
    ...patrolMutations.applyFix(),
    onSuccess: ({ applied }) => {
      if (!applied)
        toast.info("The link changed since it was checked, so it's being checked again.");
    },
    onError: (error) => toast.error(error.message || "Could not apply the fix"),
  });
  const dismiss = useMutation({
    ...patrolMutations.dismissFinding(),
    onError: (error) => toast.error(error.message || "Could not dismiss it"),
  });
  const busy = applyFix.isPending || dismiss.isPending;
  // Live's findings are fixed in the Patrol Draft, where they're as good as its own.
  const fixesHere = draftId !== null && (!finding.live || draftId === patrolDraft?.id);
  return (
    <Alert data-content-finding variant="warning" className="px-3 py-2">
      <CircleAlert />
      <AlertTitle className="text-xs font-normal">{findingSentenceInPlace(finding)}</AlertTitle>
      <AlertDescription className="text-xs">
        <p>{finding.role}</p>
        <span className="mt-1.5 flex flex-wrap gap-1">
          {fixesHere && finding.fix && (
            <Button
              variant="outline"
              size="xs"
              disabled={busy}
              onClick={() => applyFix.mutate({ projectId, findingId: finding.id })}
            >
              {fixLabel(finding.fix)}
            </Button>
          )}
          {fixesHere && (
            <Button
              variant="outline"
              size="xs"
              onClick={() =>
                studioStore.trigger.askAgent({ text: askAgentMessage(finding, finding.role) })
              }
            >
              Ask the agent
            </Button>
          )}
          {/* On Live, the finding is fixed in the Patrol Draft. */}
          {draftId === null && patrolDraft && (
            <OpenInPatrolDraft finding={finding} patrolDraft={patrolDraft} />
          )}
          <Button
            variant="ghost"
            size="xs"
            disabled={busy}
            onClick={() => dismiss.mutate({ projectId, findingId: finding.id })}
          >
            {dismissLabel(finding.about)}
          </Button>
        </span>
      </AlertDescription>
    </Alert>
  );
}

/** Opens the Patrol Draft on a Live finding's field, as the Canvas shows it there. */
function OpenInPatrolDraft({
  finding,
  patrolDraft,
}: {
  finding: FindingView;
  patrolDraft: PatrolDraft;
}) {
  const showInCanvas = useShowInCanvas();
  const { place } = finding;
  if (place?.kind !== "page") return null;
  return (
    <Button
      variant="outline"
      size="xs"
      onClick={() =>
        void showInCanvas({
          pageId: place.pageId,
          locale: finding.locale,
          blockId: place.blockId,
          itemId: place.itemId,
          field: { name: finding.field, kind: finding.fieldKind },
          draft: patrolDraft.id,
        })
      }
    >
      Open the Patrol Draft
    </Button>
  );
}
