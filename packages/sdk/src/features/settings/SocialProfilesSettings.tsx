import { socialProfileUrlSchema } from "@camox/api-contract/projects";
import { Button } from "@camox/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@camox/ui/input-group";
import { Spinner } from "@camox/ui/spinner";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import * as React from "react";

import type { Project } from "@/lib/queries";

import { SettingsPart } from "./SettingsPart";
import { useProjectMutation } from "./useProjectMutation";

/** A profile being edited, keyed so its input keeps focus as rows move. */
type Row = { key: number; url: string };

let nextRowKey = 0;
const row = (url: string): Row => ({ key: nextRowKey++, url });

export function SocialProfilesSettings({ project }: { project: Project }) {
  const [rows, setRows] = React.useState<Row[]>(() => project.socialProfiles.map(row));
  const [showErrors, setShowErrors] = React.useState(false);

  // Empty rows are dropped rather than refused, so adding one by mistake never blocks saving.
  const filled = rows.map((entry) => ({ ...entry, url: entry.url.trim() })).filter((e) => e.url);

  const save = useProjectMutation(project, "updateSocialProfiles", {
    success: "Social profiles updated",
    failure: "Could not save the social profiles",
    onSuccess: () => {
      setRows(filled);
      setShowErrors(false);
    },
  });

  const errorOf = (url: string) => {
    const result = socialProfileUrlSchema.safeParse(url.trim());
    return result.success ? undefined : result.error.issues[0]?.message;
  };

  const update = (key: number, url: string) =>
    setRows((current) => current.map((entry) => (entry.key === key ? { ...entry, url } : entry)));
  const remove = (key: number) =>
    setRows((current) => current.filter((entry) => entry.key !== key));

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    setRows((current) => {
      const from = current.findIndex((entry) => entry.key === active.id);
      const to = current.findIndex((entry) => entry.key === over.id);
      return from === -1 || to === -1 ? current : arrayMove(current, from, to);
    });
  };

  const hasChanges =
    filled.length !== project.socialProfiles.length ||
    filled.some((entry, index) => entry.url !== project.socialProfiles[index]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (filled.some((entry) => errorOf(entry.url))) {
      setShowErrors(true);
      return;
    }
    save.mutate({ id: project.id, socialProfiles: filled.map((entry) => entry.url) });
  };

  return (
    <SettingsPart
      title="Social profiles"
      description="The project's accounts elsewhere, such as on LinkedIn, X or GitHub. Search engines and AI answer engines use them to tie the website to your organization."
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        {rows.length > 0 && (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
            modifiers={[restrictToVerticalAxis]}
          >
            <SortableContext
              items={rows.map((entry) => entry.key)}
              strategy={verticalListSortingStrategy}
            >
              <ol className="flex flex-col gap-2">
                {rows.map((entry, index) => (
                  <SortableProfileRow
                    key={entry.key}
                    entry={entry}
                    index={index}
                    error={showErrors && entry.url.trim() ? errorOf(entry.url) : undefined}
                    disabled={save.isPending}
                    onChange={(url) => update(entry.key, url)}
                    onRemove={() => remove(entry.key)}
                  />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={!hasChanges || save.isPending}>
            {save.isPending && <Spinner />}
            Save
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={save.isPending}
            onClick={() => setRows((current) => [...current, row("")])}
          >
            <Plus />
            Add profile
          </Button>
        </div>
      </form>
    </SettingsPart>
  );
}

function SortableProfileRow({
  entry,
  index,
  error,
  disabled,
  onChange,
  onRemove,
}: {
  entry: Row;
  index: number;
  error: string | undefined;
  disabled: boolean;
  onChange: (url: string) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entry.key,
    disabled,
  });

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      className="flex flex-col gap-1"
    >
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Reorder profile ${index + 1}`}
          className="text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing"
          disabled={disabled}
          {...attributes}
          {...listeners}
        >
          <GripVertical />
        </Button>
        <InputGroup data-disabled={disabled || undefined}>
          <InputGroupInput
            type="url"
            value={entry.url}
            placeholder="https://www.linkedin.com/company/…"
            aria-label={`Profile ${index + 1}`}
            aria-invalid={error ? true : undefined}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
          />
          <InputGroupAddon
            align="inline-end"
            className="opacity-0 group-focus-within/input-group:opacity-100 group-hover/input-group:opacity-100"
          >
            <InputGroupButton
              size="icon-xs"
              aria-label="Remove"
              disabled={disabled}
              onClick={onRemove}
            >
              <Trash2 />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </div>
      {error && <p className="text-destructive pl-9 text-xs">{error}</p>}
    </li>
  );
}
