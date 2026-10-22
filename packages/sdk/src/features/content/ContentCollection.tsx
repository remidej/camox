import { Button } from "@camox/ui/button";
import { Input } from "@camox/ui/input";
import { Label } from "@camox/ui/label";
import { PanelContent, PanelHeader, PanelTitle } from "@camox/ui/panel";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@camox/ui/sheet";
import { Switch } from "@camox/ui/switch";
import { Textarea } from "@camox/ui/textarea";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { ListIcon, PlusCircleIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { SingleAssetFieldEditor } from "@/features/preview/components/AssetFieldEditor";
import { MultipleAssetFieldEditor } from "@/features/preview/components/MultipleAssetFieldEditor";
import { ReferenceFieldEditor } from "@/features/preview/components/ReferenceFieldEditor";
import { ReferenceListFieldEditor } from "@/features/preview/components/ReferenceListFieldEditor";
import { invalidateCollectionRecordViews } from "@/lib/collection-cache";
import {
  collectionMutations,
  type CollectionDefinition,
  type CollectionRecord,
} from "@/lib/queries";

import { reads, useReadQuery, useStudioCache } from "../../lib/studio-reads";
import {
  collectionFormFields,
  collectionFormDefaults,
  collectionFormContent,
  type FieldSchema,
} from "./collection-form";
import { useCollectionItemSheet } from "./CollectionItemSheetContext";
import { DeleteCollectionItemButton } from "./components/DeleteCollectionItemButton";

export const ContentCollection = ({
  projectUuid,
  collection,
}: {
  projectUuid: string;
  collection: CollectionDefinition;
}) => {
  const itemSheet = useCollectionItemSheet();
  const {
    data: records,
    isPending,
    isError,
    refetch,
  } = useReadQuery(reads.records({ projectUuid, collectionId: collection.collectionId }));

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <PanelHeader className="flex items-center justify-between gap-4">
        <div>
          <PanelTitle>{collection.title}</PanelTitle>
          {collection.description && (
            <p className="text-muted-foreground mt-2 text-sm">{collection.description}</p>
          )}
        </div>
        <Button
          variant="outline"
          onClick={() => itemSheet.open({ collectionId: collection.collectionId })}
        >
          <PlusIcon aria-hidden className="size-4" />
          Create item
        </Button>
      </PanelHeader>
      <PanelContent className="flex flex-col p-4">
        {isPending && (
          <p role="status" className="text-muted-foreground m-auto text-sm">
            Loading items…
          </p>
        )}
        {isError && (
          <div role="alert" className="m-auto flex flex-col items-center gap-3">
            <p className="text-muted-foreground text-sm">Could not load items.</p>
            <Button variant="outline" onClick={() => void refetch()}>
              Try again
            </Button>
          </div>
        )}
        {!isPending && !isError && records?.length === 0 && (
          <div className="m-auto flex max-w-sm flex-col items-center gap-2 text-center">
            <ListIcon aria-hidden className="text-muted-foreground mb-2 h-8 w-8" />
            <h2 className="font-medium">No items yet</h2>
            <p className="text-muted-foreground text-sm">
              Items in {collection.title} will appear here.
            </p>
            <Button
              variant="outline"
              className="mt-2"
              onClick={() => itemSheet.open({ collectionId: collection.collectionId })}
            >
              <PlusIcon aria-hidden className="size-4" />
              Create item
            </Button>
          </div>
        )}
        {!isError && records && records.length > 0 && (
          <ul aria-label={`${collection.title} items`} className="divide-y rounded-md border">
            {records.map((record) => (
              <li key={record.id} className="group hover:bg-accent flex items-center">
                <button
                  type="button"
                  onClick={() =>
                    itemSheet.open({ collectionId: collection.collectionId, itemId: record.id })
                  }
                  className="focus-visible:bg-accent flex min-w-0 flex-1 items-center gap-2 px-4 py-3 text-sm"
                >
                  <span className="flex min-w-0 flex-col items-start text-left">
                    <span className="max-w-full truncate">{record.title || "Untitled item"}</span>
                    {record.description && (
                      <span className="text-muted-foreground max-w-full truncate text-xs">
                        {record.description}
                      </span>
                    )}
                  </span>
                  {record.duplicatePageValue && (
                    <span
                      className="text-destructive shrink-0 text-xs"
                      title="Another item's page has the same URL. Change one of them before publishing."
                    >
                      Duplicate URL
                    </span>
                  )}
                </button>
                <DeleteCollectionItemButton
                  projectUuid={projectUuid}
                  collectionId={collection.collectionId}
                  id={record.id}
                  label={record.title}
                  compact
                />
              </li>
            ))}
            <li className="flex justify-start px-2 py-1">
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground font-normal"
                onClick={() => itemSheet.open({ collectionId: collection.collectionId })}
              >
                <PlusCircleIcon aria-hidden className="size-3.5" />
                Add item
              </Button>
            </li>
          </ul>
        )}
      </PanelContent>
    </div>
  );
};

const fieldLabel = (name: string, schema: FieldSchema) =>
  schema.title ?? name.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());

function CollectionItemForm({
  contentSchema,
  toTitle,
  projectUuid,
  collectionId,
  record,
  initialContent,
  onSaved,
}: {
  contentSchema: unknown;
  /** The collection's title template, whose first field the form shows first. */
  toTitle: string;
  projectUuid: string;
  collectionId: string;
  record?: CollectionRecord;
  initialContent?: Record<string, unknown>;
  onSaved: (record: CollectionRecord) => void | Promise<void>;
}) {
  const studioCache = useStudioCache();
  const fields = collectionFormFields(contentSchema, toTitle);
  // Background refetches must not replace edits.
  const [savedRecord, setSavedRecord] = useState(record);
  const [error, setError] = useState<string | null>(null);
  const create = useMutation(collectionMutations.create());
  const edit = useMutation(collectionMutations.edit());
  const [submitting, setSubmitting] = useState(false);
  const saving = submitting || create.isPending || edit.isPending;
  const [defaultValues] = useState(() =>
    collectionFormDefaults(fields, savedRecord?.content ?? initialContent),
  );
  const form = useForm({
    defaultValues,
    onSubmit: async ({ value }) => {
      if (submitting) return;
      setSubmitting(true);
      setError(null);
      try {
        const content = collectionFormContent(fields, value, savedRecord?.content);
        const scope = { projectUuid, collectionId, content };
        const saved = savedRecord
          ? await edit.mutateAsync({ ...scope, id: savedRecord.id })
          : await create.mutateAsync(scope);
        // Advance only after our own successful save, never from a refetch.
        setSavedRecord(saved);
        studioCache.set(reads.record({ projectUuid, collectionId, id: saved.id }), saved);
        await invalidateCollectionRecordViews(studioCache, projectUuid, collectionId);
        await onSaved(saved);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Please try again.";
        setError(`Could not save item. ${message}`);
        await studioCache.invalidate(reads.records({ projectUuid, collectionId }));
      } finally {
        setSubmitting(false);
      }
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
      className="mx-auto w-full max-w-2xl space-y-6"
    >
      <fieldset disabled={saving} className="space-y-6">
        {fields.map(([name, schema]) => {
          const label = fieldLabel(name, schema);
          return (
            <form.Field key={name} name={name}>
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={`collection-${name}`}>{label}</Label>
                  {schema.fieldType === "String" && schema.pattern && (
                    <Input
                      id={`collection-${name}`}
                      name={field.name}
                      value={typeof field.state.value === "string" ? field.state.value : ""}
                      minLength={schema.minLength}
                      maxLength={schema.maxLength}
                      pattern={schema.pattern}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                    />
                  )}
                  {schema.fieldType === "String" && !schema.pattern && (
                    <Textarea
                      id={`collection-${name}`}
                      name={field.name}
                      value={typeof field.state.value === "string" ? field.state.value : ""}
                      minLength={schema.minLength}
                      maxLength={schema.maxLength}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                    />
                  )}
                  {schema.fieldType === "Embed" && (
                    <Input
                      id={`collection-${name}`}
                      name={field.name}
                      type="url"
                      value={typeof field.state.value === "string" ? field.state.value : ""}
                      pattern={schema.pattern}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                    />
                  )}
                  {schema.fieldType === "Enum" && (
                    <select
                      id={`collection-${name}`}
                      name={field.name}
                      className="border-input bg-background h-9 w-full rounded-md border px-2.5 text-sm"
                      value={typeof field.state.value === "string" ? field.state.value : ""}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                    >
                      {schema.enum?.map((option) => (
                        <option key={option} value={option}>
                          {schema.enumLabels?.[option] ?? option}
                        </option>
                      ))}
                    </select>
                  )}
                  {schema.fieldType === "Boolean" && (
                    <Switch
                      id={`collection-${name}`}
                      name={field.name}
                      checked={field.state.value === true}
                      onCheckedChange={(checked) => field.handleChange(checked)}
                    />
                  )}
                  {schema.fieldType === "Reference" && schema.collectionId && (
                    <ReferenceFieldEditor
                      collectionId={schema.collectionId}
                      value={field.state.value}
                      onChange={(id) => field.handleChange(id)}
                      allowCreate={false}
                    />
                  )}
                  {schema.fieldType === "ReferenceList" && schema.collectionId && (
                    <ReferenceListFieldEditor
                      collectionId={schema.collectionId}
                      value={field.state.value}
                      maxItems={schema.maxItems}
                      onChange={(ids) => field.handleChange(ids)}
                      allowCreate={false}
                    />
                  )}
                  {["Image", "File", "ImageList", "FileList"].includes(schema.fieldType) && (
                    <fieldset aria-label={label} onBlur={field.handleBlur}>
                      {schema.fieldType.endsWith("List") ? (
                        <MultipleAssetFieldEditor
                          fieldName={name}
                          assetType={schema.fieldType === "ImageList" ? "Image" : "File"}
                          currentData={{ [name]: field.state.value }}
                          onFieldChange={(_, value) => field.handleChange(value)}
                          accept={schema.items?.accept ?? schema.accept}
                          resolveLocally
                        />
                      ) : (
                        <SingleAssetFieldEditor
                          fieldName={name}
                          assetType={schema.fieldType === "Image" ? "Image" : "File"}
                          currentData={{ [name]: field.state.value }}
                          onFieldChange={(_, value) => field.handleChange(value)}
                          accept={schema.accept}
                          resolveLocally
                        />
                      )}
                    </fieldset>
                  )}
                </div>
              )}
            </form.Field>
          );
        })}
      </fieldset>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : savedRecord ? "Save changes" : "Create item"}
        </Button>
      </div>
    </form>
  );
}

export const ContentCollectionItemEditor = ({
  collectionId,
  itemId,
  initialContent,
  onSaved,
  projectUuid,
}: {
  collectionId: string;
  itemId?: string;
  /** Prefills a new item's form; ignored when editing. */
  initialContent?: Record<string, unknown>;
  onSaved: (record: CollectionRecord) => void | Promise<void>;
  projectUuid: string;
}) => {
  const recordQuery = useReadQuery(reads.record({ projectUuid, collectionId, id: itemId ?? "" }), {
    enabled: !!itemId,
  });
  const {
    data: definition,
    isPending,
    isError,
    refetch,
  } = useReadQuery(reads.collection({ projectUuid, collectionId }));

  return (
    <>
      {isPending && <p role="status">Loading fields…</p>}
      {isError && (
        <div role="alert" className="flex items-center gap-3">
          <p>Could not load collection fields.</p>
          <Button variant="outline" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      )}
      {itemId && recordQuery.isPending && <p role="status">Loading item…</p>}
      {itemId && recordQuery.isError && (
        <div role="alert" className="flex items-center gap-3">
          <p>Could not load item. It may no longer exist.</p>
          <Button variant="outline" onClick={() => void recordQuery.refetch()}>
            Try again
          </Button>
        </div>
      )}
      {definition && (!itemId || recordQuery.data) && (
        <CollectionItemForm
          key={`${collectionId}:${itemId ?? "new"}`}
          contentSchema={definition.contentSchema}
          toTitle={definition.toTitle}
          projectUuid={projectUuid}
          collectionId={collectionId}
          record={itemId ? recordQuery.data : undefined}
          initialContent={itemId ? undefined : initialContent}
          onSaved={onSaved}
        />
      )}
    </>
  );
};

export const ContentCollectionItemSheet = ({ projectUuid }: { projectUuid: string }) => {
  const { close, complete, target } = useCollectionItemSheet();

  return (
    <Sheet open={!!target} onOpenChange={(open) => !open && close()}>
      <SheetContent side="right" className="gap-0 data-[side=right]:sm:max-w-xl">
        <SheetHeader className="border-b">
          <SheetTitle>{target?.itemId ? "Edit item" : "New item"}</SheetTitle>
          <SheetDescription>
            {target?.itemId ? "Update this collection item." : "Create a new collection item."}
            {target?.itemId && (
              <RecordUsage
                projectUuid={projectUuid}
                collectionId={target.collectionId}
                id={target.itemId}
              />
            )}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {target && (
            <ContentCollectionItemEditor
              key={`${target.collectionId}:${target.itemId ?? "new"}`}
              projectUuid={projectUuid}
              collectionId={target.collectionId}
              itemId={target.itemId}
              initialContent={target.initialContent}
              onSaved={(record) => complete(target, record)}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

/** Where a record is used: how many blocks, repeatable items and records reference it. */
function RecordUsage({
  projectUuid,
  collectionId,
  id,
}: {
  projectUuid: string;
  collectionId: string;
  id: string;
}) {
  const { data: count } = useReadQuery(reads.recordUsageCount({ projectUuid, collectionId, id }));
  if (count === undefined) return null;
  return (
    <>
      {" "}
      {count === 0 ? "Not used anywhere." : `Used in ${count} ${count === 1 ? "place" : "places"}.`}
    </>
  );
}
